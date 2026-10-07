package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const bridgeLeaseRenewInterval = 30 * time.Second

var (
	errLeaseRejected = errors.New("Bridge 租约续期未被接受")
	errLeaseExpired  = errors.New("Bridge 租约已到期")
)

type recoveryStore struct {
	jobsDir    string
	outboxDir  string
	outputsDir string
	mu         sync.Mutex
}

type durableJob struct {
	Version   int           `json:"version"`
	Request   bridgeRequest `json:"request"`
	PromptID  string        `json:"promptId,omitempty"`
	CreatedAt time.Time     `json:"createdAt"`
	UpdatedAt time.Time     `json:"updatedAt"`
}

type outboxItem struct {
	Version       int       `json:"version"`
	RequestID     string    `json:"requestId"`
	Body          jsonMap   `json:"body"`
	Acknowledged  bool      `json:"acknowledged,omitempty"`
	LeaseRejected bool      `json:"leaseRejected,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
}

type leaseResponse struct {
	Accepted       bool      `json:"accepted"`
	LeaseExpiresAt time.Time `json:"leaseExpiresAt"`
}

type resultResponse struct {
	Acknowledged bool `json:"acknowledged"`
}

type promptCheckpoint struct {
	mu       sync.RWMutex
	state    string
	promptID string
}

func (value *promptCheckpoint) setState(state string) {
	value.mu.Lock()
	value.state = state
	value.mu.Unlock()
}

func (value *promptCheckpoint) set(promptID string) {
	value.mu.Lock()
	value.state = "submitted"
	value.promptID = promptID
	value.mu.Unlock()
}

func (value *promptCheckpoint) get() jsonMap {
	value.mu.RLock()
	state := value.state
	promptID := value.promptID
	value.mu.RUnlock()
	if state == "" && promptID == "" {
		return nil
	}
	checkpoint := jsonMap{}
	if state != "" {
		checkpoint["state"] = state
	}
	if promptID != "" {
		checkpoint["promptId"] = promptID
	}
	return checkpoint
}

func newRecoveryStore(options bridgeOptions) (*recoveryStore, error) {
	configPath, err := bridgeOptionsPath()
	if err != nil {
		return nil, err
	}
	key := sha256.Sum256([]byte(
		options.Server + "\n" + options.Token + "\n" + options.Comfy,
	))
	root := filepath.Join(
		filepath.Dir(configPath),
		"comfy-bridge-state",
		fmt.Sprintf("%x", key[:]),
	)
	store := &recoveryStore{
		jobsDir:    filepath.Join(root, "jobs"),
		outboxDir:  filepath.Join(root, "outbox"),
		outputsDir: filepath.Join(root, "outputs"),
	}
	for _, directory := range []string{root, store.jobsDir, store.outboxDir, store.outputsDir} {
		if err := os.MkdirAll(directory, 0700); err != nil {
			return nil, err
		}
		if err := os.Chmod(directory, 0700); err != nil {
			return nil, err
		}
	}
	return store, nil
}

func recoveryFilename(directory, requestID string) string {
	hash := sha256.Sum256([]byte(requestID))
	return filepath.Join(directory, fmt.Sprintf("%x.json", hash[:]))
}

func writeJSONAtomic(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	removeTemporary := true
	defer func() {
		_ = temporary.Close()
		if removeTemporary {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0600); err != nil {
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	removeTemporary = false
	return os.Chmod(path, 0600)
}

func readJSONFile(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

func (store *recoveryStore) saveJob(job durableJob) error {
	job.Version = 1
	if job.CreatedAt.IsZero() {
		job.CreatedAt = time.Now()
	}
	job.UpdatedAt = time.Now()
	return writeJSONAtomic(
		recoveryFilename(store.jobsDir, job.Request.ID),
		job,
	)
}

func (store *recoveryStore) loadJob(requestID string) (durableJob, error) {
	var job durableJob
	err := readJSONFile(recoveryFilename(store.jobsDir, requestID), &job)
	return job, err
}

func (store *recoveryStore) removeJob(requestID string) error {
	err := os.Remove(recoveryFilename(store.jobsDir, requestID))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (store *recoveryStore) saveOutbox(item outboxItem) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.saveOutboxLocked(item)
}

func (store *recoveryStore) saveOutboxLocked(item outboxItem) error {
	item.Version = 1
	if item.CreatedAt.IsZero() {
		item.CreatedAt = time.Now()
	}
	return writeJSONAtomic(
		recoveryFilename(store.outboxDir, item.RequestID),
		item,
	)
}

func (store *recoveryStore) loadOutboxLocked(requestID string) (outboxItem, error) {
	var item outboxItem
	err := readJSONFile(recoveryFilename(store.outboxDir, requestID), &item)
	return item, err
}

func (store *recoveryStore) hasOutbox(requestID string) bool {
	store.mu.Lock()
	defer store.mu.Unlock()
	_, err := os.Stat(recoveryFilename(store.outboxDir, requestID))
	return err == nil
}

func (store *recoveryStore) replaceOutboxLease(
	requestID, leaseToken string,
) (bool, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	item, err := store.loadOutboxLocked(requestID)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if item.Body == nil {
		return false, errors.New("Bridge 本地待回传结果无效")
	}
	item.Body["leaseToken"] = leaseToken
	item.LeaseRejected = false
	return true, store.saveOutboxLocked(item)
}

func (store *recoveryStore) rejectOutboxLease(
	requestID, leaseToken string,
) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	item, err := store.loadOutboxLocked(requestID)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil || stringValue(item.Body["leaseToken"]) != leaseToken {
		return err
	}
	item.LeaseRejected = true
	return store.saveOutboxLocked(item)
}

func (store *recoveryStore) acknowledgeOutboxLease(
	requestID, leaseToken string,
) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	item, err := store.loadOutboxLocked(requestID)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil || stringValue(item.Body["leaseToken"]) != leaseToken {
		return err
	}
	item.Acknowledged = true
	return store.saveOutboxLocked(item)
}

func (store *recoveryStore) removeOutboxLease(
	requestID, leaseToken string,
) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	item, err := store.loadOutboxLocked(requestID)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil || stringValue(item.Body["leaseToken"]) != leaseToken {
		return err
	}
	err = os.Remove(recoveryFilename(store.outboxDir, requestID))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func loadRecoveryFiles[T any](directory string) []T {
	entries, err := os.ReadDir(directory)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ComfyUI Bridge 读取恢复目录失败：%v\n", err)
		return nil
	}
	items := make([]T, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		var item T
		if err := readJSONFile(filepath.Join(directory, entry.Name()), &item); err != nil {
			fmt.Fprintf(os.Stderr, "ComfyUI Bridge 读取恢复文件失败（%s）：%v\n", entry.Name(), err)
			continue
		}
		items = append(items, item)
	}
	return items
}

func updateLease(
	ctx context.Context,
	options bridgeOptions,
	request bridgeRequest,
	checkpoint jsonMap,
) (leaseResponse, error) {
	body := jsonMap{
		"requestId":  request.ID,
		"leaseToken": request.LeaseToken,
	}
	if len(checkpoint) > 0 {
		body["checkpoint"] = checkpoint
	}
	var response leaseResponse
	err := requestBridgeJSONContext(
		ctx,
		options,
		http.MethodPost,
		options.Server+"/api/bridge/comfy/lease",
		body,
		&response,
	)
	if err != nil {
		return leaseResponse{}, err
	}
	if !response.Accepted {
		return leaseResponse{}, errLeaseRejected
	}
	return response, nil
}

func leaseWasReplaced(err error) bool {
	var responseErr *bridgeResponseError
	return errors.Is(err, errLeaseRejected) ||
		(errors.As(err, &responseErr) &&
			(responseErr.StatusCode == http.StatusConflict ||
				responseErr.StatusCode == http.StatusNotFound ||
				responseErr.StatusCode == http.StatusUnauthorized))
}

func renewLeaseLoop(
	ctx context.Context,
	options bridgeOptions,
	request bridgeRequest,
	checkpoint *promptCheckpoint,
	onReplaced func(error),
	done chan<- struct{},
) {
	defer close(done)
	deadline := request.LeaseExpiresAt
	if deadline.IsZero() || !time.Now().Before(deadline) {
		onReplaced(errLeaseExpired)
		return
	}
	ticker := time.NewTicker(bridgeLeaseRenewInterval)
	defer ticker.Stop()
	leaseTimer := time.NewTimer(time.Until(deadline))
	defer leaseTimer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-leaseTimer.C:
			onReplaced(errLeaseExpired)
			return
		case <-ticker.C:
			renewContext, cancel := context.WithDeadline(ctx, deadline)
			response, err := updateLease(
				renewContext,
				options,
				request,
				checkpoint.get(),
			)
			cancel()
			if err == nil {
				if !response.LeaseExpiresAt.After(time.Now()) {
					onReplaced(errLeaseExpired)
					return
				}
				deadline = response.LeaseExpiresAt
				if !leaseTimer.Stop() {
					select {
					case <-leaseTimer.C:
					default:
					}
				}
				leaseTimer.Reset(time.Until(deadline))
				continue
			}
			if ctx.Err() != nil {
				return
			}
			if leaseWasReplaced(err) {
				onReplaced(err)
				return
			}
			if !time.Now().Before(deadline) {
				onReplaced(errors.Join(errLeaseExpired, err))
				return
			}
			fmt.Fprintf(
				os.Stderr,
				"ComfyUI Bridge 租约续期失败（请求 %s）：%v\n",
				request.ID,
				err,
			)
		}
	}
}

func executeDurableRequest(
	options bridgeOptions,
	store *recoveryStore,
	request bridgeRequest,
) {
	if request.LeaseToken == "" {
		fmt.Fprintf(os.Stderr, "ComfyUI Bridge 请求 %s 缺少租约令牌\n", request.ID)
		return
	}
	if replaced, err := store.replaceOutboxLease(
		request.ID,
		request.LeaseToken,
	); err != nil {
		fmt.Fprintf(os.Stderr, "ComfyUI Bridge 更新待回传结果失败（请求 %s）：%v\n", request.ID, err)
		return
	} else if replaced {
		if err := store.removeJob(request.ID); err != nil {
			fmt.Fprintf(os.Stderr, "ComfyUI Bridge 更新待回传结果失败（请求 %s）：%v\n", request.ID, err)
		}
		return
	}

	job := durableJob{Request: request, CreatedAt: time.Now()}
	if existing, err := store.loadJob(request.ID); err == nil {
		job.CreatedAt = existing.CreatedAt
		job.PromptID = existing.PromptID
	}
	if job.PromptID == "" {
		job.PromptID = checkpointPromptID(request.Checkpoint)
	}
	job.Request = request
	if err := store.saveJob(job); err != nil {
		fmt.Fprintf(os.Stderr, "ComfyUI Bridge 保存执行记录失败（请求 %s）：%v\n", request.ID, err)
		return
	}

	checkpointState := stringValue(request.Checkpoint["state"])
	if job.PromptID != "" {
		checkpointState = "submitted"
	}
	checkpoint := &promptCheckpoint{state: checkpointState, promptID: job.PromptID}
	if request.LeaseExpiresAt.IsZero() ||
		!time.Now().Before(request.LeaseExpiresAt) {
		renewed, err := updateLease(
			context.Background(),
			options,
			request,
			checkpoint.get(),
		)
		if err == nil {
			request.LeaseExpiresAt = renewed.LeaseExpiresAt
			job.Request = request
			_ = store.saveJob(job)
		}
		if err != nil {
			if leaseWasReplaced(err) {
				fmt.Fprintf(os.Stderr, "ComfyUI Bridge 请求 %s 已由新租约接管，保留本地恢复记录\n", request.ID)
			} else {
				fmt.Fprintf(os.Stderr, "ComfyUI Bridge 暂时无法确认请求 %s 的租约：%v\n", request.ID, err)
			}
			return
		}
	}

	executionContext, cancelExecution := context.WithCancel(context.Background())
	leaseContext, cancelLease := context.WithCancel(context.Background())
	leaseDone := make(chan struct{})
	leaseLost := make(chan error, 1)
	reportLeaseLoss := func(err error) {
		select {
		case leaseLost <- err:
		default:
		}
		cancelExecution()
	}
	go renewLeaseLoop(
		leaseContext,
		options,
		request,
		checkpoint,
		reportLeaseLoss,
		leaseDone,
	)

	syncCheckpoint := func(saveLocal bool) error {
		for {
			var localErr error
			if saveLocal {
				localErr = store.saveJob(job)
			}
			_, remoteErr := updateLease(executionContext, options, request, checkpoint.get())
			if leaseWasReplaced(remoteErr) {
				reportLeaseLoss(remoteErr)
				return remoteErr
			}
			if remoteErr == nil {
				if localErr != nil {
					fmt.Fprintf(os.Stderr, "ComfyUI Bridge 保存本地检查点失败（请求 %s）：%v\n", request.ID, localErr)
				}
				return nil
			}
			fmt.Fprintf(os.Stderr, "ComfyUI Bridge 保存执行检查点失败（请求 %s），稍后重试：%v\n", request.ID, errors.Join(localErr, remoteErr))
			timer := time.NewTimer(time.Second)
			select {
			case <-executionContext.Done():
				if !timer.Stop() {
					<-timer.C
				}
				return executionContext.Err()
			case <-timer.C:
			}
		}
	}

	var result jsonMap
	var runErr error
	if job.PromptID == "" && checkpointState == "submitting" {
		runErr = errors.New("Bridge 在提交 ComfyUI 任务期间中断；为避免重复提交，任务已终止")
	} else {
		result, runErr = runComfyRequestFromCheckpoint(
			executionContext,
			options,
			store,
			request.Payload,
			job.PromptID,
			func() error {
				checkpoint.setState("submitting")
				return syncCheckpoint(false)
			},
			func(promptID string) error {
				job.PromptID = promptID
				checkpoint.set(promptID)
				return syncCheckpoint(true)
			},
		)
	}
	cancelExecution()
	cancelLease()
	<-leaseDone
	select {
	case err := <-leaseLost:
		fmt.Fprintf(os.Stderr, "ComfyUI Bridge 请求 %s 的租约已被替换：%v\n", request.ID, err)
		return
	default:
	}

	body := jsonMap{
		"requestId":  request.ID,
		"leaseToken": request.LeaseToken,
		"status":     "succeeded",
	}
	resultTooLarge := false
	if runErr != nil {
		body["status"] = "failed"
		body["error"] = runErr.Error()
	} else {
		resultJSON, resultErr := json.Marshal(result)
		if resultErr != nil {
			body["status"] = "failed"
			body["error"] = "Bridge 结果格式无效"
		} else {
			body["result"] = result
			resultTooLarge = len(resultJSON) > 128<<20
		}
	}
	bodyJSON, bodyErr := json.Marshal(body)
	if bodyErr != nil {
		delete(body, "result")
		body["status"] = "failed"
		body["error"] = "Bridge 结果格式无效"
	} else if resultTooLarge || len(bodyJSON) > 129<<20 {
		delete(body, "result")
		body["status"] = "failed"
		body["error"] = "多个产物合计超过 128MB"
	}
	item := outboxItem{
		RequestID: request.ID,
		Body:      body,
		CreatedAt: time.Now(),
	}
	if err := store.saveOutbox(item); err != nil {
		fmt.Fprintf(os.Stderr, "ComfyUI Bridge 保存待回传结果失败（请求 %s）：%v\n", request.ID, err)
		return
	}
	if err := store.removeJob(request.ID); err != nil {
		fmt.Fprintf(os.Stderr, "ComfyUI Bridge 删除执行记录失败（请求 %s）：%v\n", request.ID, err)
	}
}

func checkpointPromptID(checkpoint jsonMap) string {
	return firstNonEmpty(
		stringValue(checkpoint["promptId"]),
		stringValue(checkpoint["prompt_id"]),
	)
}

func prepareRecovery(store *recoveryStore) {
	for _, item := range loadRecoveryFiles[outboxItem](store.outboxDir) {
		if item.RequestID == "" {
			continue
		}
		if err := store.removeJob(item.RequestID); err != nil {
			fmt.Fprintf(os.Stderr, "ComfyUI Bridge 清理已完成执行记录失败（请求 %s）：%v\n", item.RequestID, err)
		}
	}
}

func resumeDurableJobs(options bridgeOptions, store *recoveryStore) {
	for _, job := range loadRecoveryFiles[durableJob](store.jobsDir) {
		if job.Request.ID == "" || store.hasOutbox(job.Request.ID) {
			continue
		}
		if job.PromptID == "" {
			// A request without a durable prompt_id must be reclaimed before it can
			// safely submit again. The poll response supplies the current lease.
			continue
		}
		executeDurableRequest(options, store, job.Request)
	}
}

func submitResult(
	options bridgeOptions,
	body jsonMap,
) (bool, error) {
	var response resultResponse
	err := requestBridgeJSON(
		options,
		http.MethodPost,
		options.Server+"/api/bridge/comfy/result",
		body,
		&response,
	)
	if err != nil {
		return false, err
	}
	return response.Acknowledged, nil
}

func outboxLoop(options bridgeOptions, store *recoveryStore) {
	for {
		items := loadRecoveryFiles[outboxItem](store.outboxDir)
		for _, item := range items {
			if item.RequestID == "" || len(item.Body) == 0 {
				continue
			}
			if err := store.removeJob(item.RequestID); err != nil {
				fmt.Fprintf(os.Stderr, "ComfyUI Bridge 清理已完成执行记录失败（请求 %s）：%v\n", item.RequestID, err)
			}
			if item.LeaseRejected {
				continue
			}
			if item.Acknowledged {
				continue
			}
			acknowledged, err := submitResult(options, item.Body)
			if err != nil {
				if leaseWasReplaced(err) {
					if saveErr := store.rejectOutboxLease(
						item.RequestID,
						stringValue(item.Body["leaseToken"]),
					); saveErr != nil {
						fmt.Fprintf(os.Stderr, "ComfyUI Bridge 暂停旧租约结果失败（请求 %s）：%v\n", item.RequestID, saveErr)
					}
					continue
				}
				fmt.Fprintf(os.Stderr, "ComfyUI Bridge 结果回传失败（请求 %s）：%v\n", item.RequestID, err)
				continue
			}
			if !acknowledged {
				fmt.Fprintf(os.Stderr, "ComfyUI Bridge 结果尚未确认（请求 %s）\n", item.RequestID)
				continue
			}
			if err := store.acknowledgeOutboxLease(
				item.RequestID,
				stringValue(item.Body["leaseToken"]),
			); err != nil {
				fmt.Fprintf(os.Stderr, "ComfyUI Bridge 保存结果确认失败（请求 %s）：%v\n", item.RequestID, err)
			}
		}
		time.Sleep(5 * time.Second)
	}
}
