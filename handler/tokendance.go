package handler

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

const tokenDanceTaskSeparator = "::"

func prepareTokenDanceRequest(input aiProtocolRequest) (aiProtocolRequest, bool, error) {
	if !service.IsTokenDanceChannel(input.channel) {
		return input, false, nil
	}
	if input.endpoint != "/images/generations" && input.endpoint != "/images/edits" && input.endpoint != "/videos" {
		return input, false, nil
	}

	input.failureLabel = "TokenDance"
	payload, err := tokenDanceRequestPayload(input.body, input.contentType)
	if err != nil {
		return input, true, err
	}
	protocol, err := tokenDanceRequestProtocol(input.modelName, input.endpoint, payload)
	if err != nil {
		return input, true, err
	}

	input.protocol = protocol
	input.path = tokenDanceCreatePath(protocol, input.endpoint)

	switch protocol {
	case "openai:image-generations":
		if input.mode == aiProtocolDirectRequest && input.endpoint == "/images/edits" {
			input.formData = true
		}
		return input, true, nil
	case "ark:image-generations":
		input.body, err = json.Marshal(tokenDanceArkImageBody(payload, input.modelName))
	case "seedance:generations":
		input.body, err = tokenDanceSeedanceBody(payload, input.modelName)
	case "kling:text2video", "kling:image2video", "kling:motion-control", "kling:omni-video":
		input.body, err = json.Marshal(tokenDanceKlingBody(payload, input.modelName, protocol))
	case "wan3:video-synthesis":
		input.body, err = json.Marshal(tokenDanceWanBody(payload, input.modelName))
	case "happyhorse:video-synthesis":
		input.body, err = json.Marshal(tokenDanceHappyHorseBody(payload, input.modelName))
	case "minimax:video_generation_v2":
		input.body, err = json.Marshal(tokenDanceMiniMaxVideoBody(payload, input.modelName))
	default:
		err = fmt.Errorf("当前 TokenDance 协议暂未适配：%s", protocol)
	}
	if err != nil {
		return input, true, err
	}
	input.contentType = "application/json"
	return input, true, nil
}

func tokenDanceRequestProtocol(modelName string, endpoint string, payload map[string]any) (string, error) {
	protocols, err := service.TokenDanceSupportedProtocols(modelName)
	if err != nil {
		return "", err
	}
	supported := make(map[string]bool, len(protocols))
	for _, protocol := range protocols {
		supported[strings.ToLower(strings.TrimSpace(protocol))] = true
	}

	var candidates []string
	switch endpoint {
	case "/images/generations":
		candidates = []string{"openai:image-generations", "ark:image-generations"}
	case "/images/edits":
		candidates = []string{"ark:image-generations", "openai:image-generations"}
	case "/videos":
		candidates = tokenDanceVideoProtocolCandidates(payload)
	}
	for _, protocol := range candidates {
		if supported[protocol] {
			return protocol, nil
		}
	}
	return "", fmt.Errorf("模型 %s 不支持当前图片或视频输入方式，可用协议：%s", modelName, strings.Join(protocols, ", "))
}

func tokenDanceVideoProtocolCandidates(payload map[string]any) []string {
	images := tokenDanceStrings(payload["input_reference[]"])
	videos := tokenDanceStrings(payload["video_reference[]"])
	audios := tokenDanceStrings(payload["audio_reference[]"])
	firstFrame := strings.TrimSpace(toStringSafe(payload["first_frame_url"]))
	lastFrame := strings.TrimSpace(toStringSafe(payload["last_frame_url"]))

	if len(images) > 0 && len(videos) > 0 && len(audios) == 0 && firstFrame == "" && lastFrame == "" {
		return []string{"kling:motion-control", "seedance:generations", "wan3:video-synthesis", "minimax:video_generation_v2", "kling:omni-video"}
	}
	if firstFrame != "" && lastFrame != "" {
		return []string{"seedance:generations", "wan3:video-synthesis", "minimax:video_generation_v2", "kling:image2video"}
	}
	if firstFrame != "" || len(images) > 0 {
		return []string{"seedance:generations", "wan3:video-synthesis", "minimax:video_generation_v2", "kling:image2video", "kling:omni-video", "happyhorse:video-synthesis"}
	}
	if len(audios) > 0 {
		return []string{"seedance:generations", "wan3:video-synthesis", "minimax:video_generation_v2", "kling:omni-video"}
	}
	if len(videos) > 0 {
		return []string{"seedance:generations", "wan3:video-synthesis", "minimax:video_generation_v2", "kling:omni-video", "happyhorse:video-synthesis"}
	}
	return []string{"seedance:generations", "kling:text2video", "kling:omni-video", "wan3:video-synthesis", "happyhorse:video-synthesis", "minimax:video_generation_v2"}
}

func tokenDanceCreatePath(protocol string, endpoint string) string {
	switch protocol {
	case "openai:image-generations":
		return endpoint
	case "ark:image-generations":
		return "/ark/v3/images/generations"
	case "seedance:generations":
		return "/ark/v3/generations/tasks"
	case "kling:text2video":
		return "/kling/v1/text2video"
	case "kling:image2video":
		return "/kling/v1/image2video"
	case "kling:motion-control":
		return "/kling/v1/motion-control"
	case "kling:omni-video":
		return "/kling/v1/omni-video"
	case "wan3:video-synthesis":
		return "/alibaba/wan3/v1/video-synthesis"
	case "happyhorse:video-synthesis":
		return "/alibaba/happyhorse/v1/video-synthesis"
	case "minimax:video_generation_v2":
		return "/minimax/v2/video_generation"
	default:
		return endpoint
	}
}

func tokenDancePollPath(protocol string, taskID string) string {
	taskID = url.PathEscape(strings.TrimSpace(taskID))
	switch protocol {
	case "seedance:generations":
		return "/ark/v3/generations/tasks/" + taskID
	case "kling:text2video":
		return "/kling/v1/text2video/" + taskID
	case "kling:image2video":
		return "/kling/v1/image2video/" + taskID
	case "kling:motion-control":
		return "/kling/v1/motion-control/" + taskID
	case "kling:omni-video":
		return "/kling/v1/omni-video/" + taskID
	case "wan3:video-synthesis":
		return "/alibaba/wan3/v1/tasks/" + taskID
	case "happyhorse:video-synthesis":
		return "/alibaba/happyhorse/v1/tasks/" + taskID
	case "minimax:video_generation_v2":
		return "/minimax/v2/query/video_generation/" + taskID
	default:
		return ""
	}
}

func tokenDanceTaskID(protocol string, taskID string) string {
	return strings.TrimSpace(protocol) + tokenDanceTaskSeparator + strings.TrimSpace(taskID)
}

func parseTokenDanceTaskID(value string) (string, string, bool) {
	parts := strings.SplitN(strings.TrimSpace(value), tokenDanceTaskSeparator, 2)
	if len(parts) != 2 || tokenDancePollPath(parts[0], parts[1]) == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

func tokenDanceRequestPayload(body []byte, contentType string) (map[string]any, error) {
	if !strings.HasPrefix(strings.ToLower(contentType), "multipart/form-data") {
		payload := map[string]any{}
		if json.Unmarshal(body, &payload) != nil {
			return nil, errors.New("TokenDance 请求参数格式错误")
		}
		return payload, nil
	}

	_, params, err := mime.ParseMediaType(contentType)
	if err != nil || params["boundary"] == "" {
		return nil, errors.New("TokenDance multipart 参数格式错误")
	}
	form, err := multipart.NewReader(bytes.NewReader(body), params["boundary"]).ReadForm(32 << 20)
	if err != nil {
		return nil, errors.New("TokenDance multipart 参数读取失败")
	}
	defer form.RemoveAll()

	payload := map[string]any{}
	for key, values := range form.Value {
		for _, value := range values {
			tokenDanceAppend(payload, key, value)
		}
	}
	for key, headers := range form.File {
		for _, header := range headers {
			file, openErr := header.Open()
			if openErr != nil {
				return nil, openErr
			}
			data, readErr := io.ReadAll(io.LimitReader(file, 32<<20))
			file.Close()
			if readErr != nil {
				return nil, readErr
			}
			contentType := header.Header.Get("Content-Type")
			if contentType == "" {
				contentType = http.DetectContentType(data)
			}
			if !strings.HasPrefix(strings.ToLower(contentType), "image/") {
				return nil, errors.New("TokenDance 本地视频和音频参考必须先取得公网地址")
			}
			tokenDanceAppend(payload, key, "data:"+contentType+";base64,"+base64.StdEncoding.EncodeToString(data))
		}
	}
	return payload, nil
}

func tokenDanceAppend(payload map[string]any, key string, value any) {
	current, exists := payload[key]
	if !exists {
		payload[key] = value
		return
	}
	if values, ok := current.([]any); ok {
		payload[key] = append(values, value)
		return
	}
	payload[key] = []any{current, value}
}

func tokenDanceStrings(value any) []string {
	switch typed := value.(type) {
	case string:
		if text := strings.TrimSpace(typed); text != "" {
			return []string{text}
		}
	case []string:
		result := make([]string, 0, len(typed))
		for _, value := range typed {
			if text := strings.TrimSpace(value); text != "" {
				result = append(result, text)
			}
		}
		return result
	case []any:
		result := []string{}
		for _, value := range typed {
			result = append(result, tokenDanceStrings(value)...)
		}
		return result
	case map[string]any:
		return tokenDanceStrings(typed["url"])
	}
	return nil
}

func tokenDanceImageReferences(payload map[string]any) []string {
	result := []string{}
	for _, key := range []string{"image", "image[]", "images", "input_reference[]"} {
		result = append(result, tokenDanceStrings(payload[key])...)
	}
	return result
}

func tokenDanceArkImageBody(payload map[string]any, modelName string) map[string]any {
	result := map[string]any{
		"model":           modelName,
		"prompt":          strings.TrimSpace(toStringSafe(payload["prompt"])),
		"response_format": firstNonEmpty(strings.TrimSpace(toStringSafe(payload["response_format"])), "url"),
	}
	for _, key := range []string{"size", "output_format", "watermark", "seed", "sequential_image_generation", "sequential_image_generation_options", "stream", "tools"} {
		if value, ok := payload[key]; ok {
			result[key] = value
		}
	}
	if images := tokenDanceImageReferences(payload); len(images) == 1 {
		result["image"] = images[0]
	} else if len(images) > 1 {
		result["image"] = images
	}
	return result
}

func tokenDanceSeedanceBody(payload map[string]any, modelName string) ([]byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	body, err = normalizeArkSeedanceVideoBody(body, modelName)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(toStringSafe(payload["first_frame_url"])) == "" && strings.TrimSpace(toStringSafe(payload["last_frame_url"])) == "" {
		return body, nil
	}
	result := map[string]any{}
	if json.Unmarshal(body, &result) == nil {
		result["ratio"] = "adaptive"
		return json.Marshal(result)
	}
	return body, nil
}

func tokenDanceKlingBody(payload map[string]any, modelName string, protocol string) map[string]any {
	prompt := strings.TrimSpace(toStringSafe(payload["prompt"]))
	images := tokenDanceStrings(payload["input_reference[]"])
	videos := tokenDanceStrings(payload["video_reference[]"])
	audios := tokenDanceStrings(payload["audio_reference[]"])
	firstFrame := strings.TrimSpace(toStringSafe(payload["first_frame_url"]))
	lastFrame := strings.TrimSpace(toStringSafe(payload["last_frame_url"]))

	settings := map[string]any{
		"resolution":   strings.ToLower(strings.TrimSpace(toStringSafe(payload["resolution_name"]))),
		"duration":     tokenDanceInt(payload["seconds"]),
		"aspect_ratio": tokenDanceRatio(strings.TrimSpace(toStringSafe(payload["size"]))),
	}
	if value, ok := payload["video_generate_audio"]; ok {
		if boolLike(value) {
			settings["audio"] = "on"
		} else {
			settings["audio"] = "off"
		}
	}

	result := map[string]any{"model_name": modelName, "settings": settings}
	if protocol == "kling:text2video" {
		result["prompt"] = prompt
		return result
	}

	contents := []any{map[string]any{"type": "prompt", "text": prompt}}
	if protocol == "kling:motion-control" {
		if len(images) > 0 {
			contents = append(contents, map[string]any{"type": "image", "url": images[0]})
		}
		if len(videos) > 0 {
			contents = append(contents, map[string]any{"type": "video", "url": videos[0]})
		}
		settings["character_orientation"] = firstNonEmpty(strings.TrimSpace(toStringSafe(payload["character_orientation"])), "video")
		result["contents"] = contents
		return result
	}

	if protocol == "kling:image2video" {
		if firstFrame == "" && len(images) > 0 {
			firstFrame, images = images[0], images[1:]
		}
		if lastFrame == "" && len(images) > 0 {
			lastFrame, images = images[0], images[1:]
		}
	}
	if firstFrame != "" {
		contents = append(contents, map[string]any{"type": "first_frame", "url": firstFrame})
	}
	if lastFrame != "" {
		contents = append(contents, map[string]any{"type": "last_frame", "url": lastFrame})
	}
	for _, image := range images {
		contents = append(contents, map[string]any{"type": "image", "url": image})
	}
	for _, video := range videos {
		contents = append(contents, map[string]any{"type": "video", "url": video})
	}
	for _, audio := range audios {
		contents = append(contents, map[string]any{"type": "audio", "url": audio})
	}
	result["contents"] = contents
	return result
}

func tokenDanceWanBody(payload map[string]any, modelName string) map[string]any {
	media := []any{}
	for _, image := range tokenDanceStrings(payload["input_reference[]"]) {
		media = append(media, map[string]any{"type": "reference_image", "url": image})
	}
	if value := strings.TrimSpace(toStringSafe(payload["first_frame_url"])); value != "" {
		media = append(media, map[string]any{"type": "first_frame", "url": value})
	}
	if value := strings.TrimSpace(toStringSafe(payload["last_frame_url"])); value != "" {
		media = append(media, map[string]any{"type": "last_frame", "url": value})
	}
	for _, video := range tokenDanceStrings(payload["video_reference[]"]) {
		media = append(media, map[string]any{"type": "reference_video", "url": video})
	}
	for _, audio := range tokenDanceStrings(payload["audio_reference[]"]) {
		media = append(media, map[string]any{"type": "reference_audio", "url": audio})
	}

	resolution := strings.ToUpper(strings.TrimSpace(toStringSafe(payload["resolution_name"])))
	input := map[string]any{"prompt": strings.TrimSpace(toStringSafe(payload["prompt"]))}
	if len(media) > 0 {
		input["media"] = media
	}
	return map[string]any{
		"model": modelName,
		"input": input,
		"parameters": map[string]any{
			"resolution": resolution,
			"ratio":      firstNonEmpty(tokenDanceRatio(strings.TrimSpace(toStringSafe(payload["size"]))), "16:9"),
			"duration":   tokenDanceInt(payload["seconds"]),
			"audio":      boolLike(payload["video_generate_audio"]),
			"watermark":  boolLike(payload["video_watermark"]),
		},
	}
}

func tokenDanceHappyHorseBody(payload map[string]any, modelName string) map[string]any {
	images := tokenDanceStrings(payload["input_reference[]"])
	videos := tokenDanceStrings(payload["video_reference[]"])
	input := map[string]any{"prompt": strings.TrimSpace(toStringSafe(payload["prompt"]))}
	if len(videos) > 0 {
		input["video_url"] = videos[0]
	} else if len(images) == 1 {
		input["img_url"] = images[0]
	} else if len(images) > 1 {
		input["ref_images_url"] = images
	} else if firstFrame := strings.TrimSpace(toStringSafe(payload["first_frame_url"])); firstFrame != "" {
		input["img_url"] = firstFrame
	}
	parameters := map[string]any{
		"resolution": strings.ToUpper(strings.TrimSpace(toStringSafe(payload["resolution_name"]))),
		"duration":   tokenDanceInt(payload["seconds"]),
		"watermark":  boolLike(payload["video_watermark"]),
	}
	if strings.HasSuffix(modelName, "-t2v") || strings.HasSuffix(modelName, "-r2v") {
		ratio := tokenDanceRatio(strings.TrimSpace(toStringSafe(payload["size"])))
		if ratio == "" || ratio == "adaptive" {
			ratio = "16:9"
		}
		parameters["ratio"] = ratio
	}
	return map[string]any{
		"model":      modelName,
		"input":      input,
		"parameters": parameters,
	}
}

func tokenDanceMiniMaxVideoBody(payload map[string]any, modelName string) map[string]any {
	content := []any{map[string]any{"type": "text", "text": strings.TrimSpace(toStringSafe(payload["prompt"]))}}
	firstFrame := strings.TrimSpace(toStringSafe(payload["first_frame_url"]))
	lastFrame := strings.TrimSpace(toStringSafe(payload["last_frame_url"]))
	if firstFrame != "" {
		content = append(content, map[string]any{"type": "image_url", "image_url": map[string]any{"url": firstFrame}, "role": "first_frame"})
	}
	if lastFrame != "" {
		content = append(content, map[string]any{"type": "image_url", "image_url": map[string]any{"url": lastFrame}, "role": "last_frame"})
	}
	for _, image := range tokenDanceStrings(payload["input_reference[]"]) {
		content = append(content, map[string]any{"type": "image_url", "image_url": map[string]any{"url": image}, "role": "reference_image"})
	}
	for _, video := range tokenDanceStrings(payload["video_reference[]"]) {
		content = append(content, map[string]any{"type": "video_url", "video_url": map[string]any{"url": video}, "role": "reference_video"})
	}
	for _, audio := range tokenDanceStrings(payload["audio_reference[]"]) {
		content = append(content, map[string]any{"type": "audio_url", "audio_url": map[string]any{"url": audio}, "role": "reference_audio"})
	}

	resolution := strings.ToUpper(strings.TrimSpace(toStringSafe(payload["resolution_name"])))
	if resolution == "720P" {
		resolution = "768P"
	}
	result := map[string]any{
		"model":      modelName,
		"resolution": resolution,
		"duration":   tokenDanceInt(payload["seconds"]),
		"content":    content,
	}
	if firstFrame == "" && lastFrame == "" {
		result["ratio"] = firstNonEmpty(tokenDanceRatio(strings.TrimSpace(toStringSafe(payload["size"]))), "16:9")
	}
	return result
}

func tokenDanceRatio(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "adaptive", "21:9", "16:9", "9:16", "4:3", "3:4", "1:1":
		return value
	}
	parts := strings.Split(value, "x")
	if len(parts) != 2 {
		return ""
	}
	width, _ := strconv.Atoi(parts[0])
	height, _ := strconv.Atoi(parts[1])
	if width <= 0 || height <= 0 {
		return ""
	}
	switch {
	case width == height:
		return "1:1"
	case width*9 == height*16:
		return "16:9"
	case width*16 == height*9:
		return "9:16"
	case width*3 == height*4:
		return "4:3"
	case width*4 == height*3:
		return "3:4"
	default:
		return ""
	}
}

func tokenDanceInt(value any) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case string:
		result, _ := strconv.Atoi(strings.TrimSpace(typed))
		return result
	default:
		return 0
	}
}

func transformTokenDanceVideoResponse(payload []byte, request *http.Request, channel model.ModelChannel, modelName string, _ bool) ([]byte, bool) {
	if !service.IsTokenDanceChannel(channel) {
		return nil, false
	}
	protocol := tokenDanceProtocolFromPath(request.URL.Path)
	if protocol == "" {
		return nil, false
	}

	var root any
	if json.Unmarshal(payload, &root) != nil {
		return nil, false
	}
	taskID := firstNonEmpty(
		tokenDanceStringPath(root, "id"),
		tokenDanceStringPath(root, "task_id"),
		tokenDanceStringPath(root, "data.id"),
		tokenDanceStringPath(root, "data.0.id"),
		tokenDanceStringPath(root, "output.task_id"),
		tokenDanceStringPath(root, "task.id"),
	)
	if taskID == "" {
		return nil, false
	}

	videoURL := tokenDanceVideoURL(root)
	rawStatus := firstNonEmpty(
		tokenDanceStringPath(root, "status"),
		tokenDanceStringPath(root, "state"),
		tokenDanceStringPath(root, "data.status"),
		tokenDanceStringPath(root, "data.0.status"),
		tokenDanceStringPath(root, "output.task_status"),
		tokenDanceStringPath(root, "task.status"),
	)
	status := service.NormalizeVideoTaskStatus(rawStatus)
	switch strings.ToLower(strings.TrimSpace(rawStatus)) {
	case "succeed":
		status = "completed"
	case "expired", "violation", "unknown":
		status = "failed"
	}
	if videoURL != "" {
		status = "completed"
	}
	if status == "" {
		status = "processing"
	}

	progress := tokenDanceInt(tokenDancePath(root, "progress"))
	if progress == 0 {
		progress = tokenDanceInt(tokenDancePath(root, "data.0.progress"))
	}
	errorMessage := tokenDancePayloadError(payload)
	result := map[string]any{
		"id":       tokenDanceTaskID(protocol, taskID),
		"task_id":  tokenDanceTaskID(protocol, taskID),
		"status":   status,
		"progress": progress,
		"model":    modelName,
	}
	if videoURL != "" {
		result["video_url"] = videoURL
		result["url"] = videoURL
		result["progress"] = 100
	}
	if errorMessage != "" {
		result["error"] = map[string]any{"message": errorMessage}
	}
	encoded, err := json.Marshal(result)
	return encoded, err == nil
}

func tokenDanceProtocolFromPath(path string) string {
	path = strings.ToLower(path)
	switch {
	case strings.Contains(path, "/ark/v3/generations/tasks"):
		return "seedance:generations"
	case strings.Contains(path, "/kling/v1/text2video"):
		return "kling:text2video"
	case strings.Contains(path, "/kling/v1/image2video"):
		return "kling:image2video"
	case strings.Contains(path, "/kling/v1/motion-control"):
		return "kling:motion-control"
	case strings.Contains(path, "/kling/v1/omni-video"):
		return "kling:omni-video"
	case strings.Contains(path, "/alibaba/wan3/"):
		return "wan3:video-synthesis"
	case strings.Contains(path, "/alibaba/happyhorse/"):
		return "happyhorse:video-synthesis"
	case strings.Contains(path, "/minimax/v2/"):
		return "minimax:video_generation_v2"
	default:
		return ""
	}
}

func tokenDancePath(value any, path string) any {
	current := value
	for _, part := range strings.Split(path, ".") {
		switch typed := current.(type) {
		case map[string]any:
			current = typed[part]
		case []any:
			index, err := strconv.Atoi(part)
			if err != nil || index < 0 || index >= len(typed) {
				return nil
			}
			current = typed[index]
		default:
			return nil
		}
	}
	return current
}

func tokenDanceStringPath(value any, path string) string {
	return strings.TrimSpace(toStringSafe(tokenDancePath(value, path)))
}

func tokenDanceVideoURL(root any) string {
	for _, path := range []string{"content.video_url", "output.video_url", "task.content.url"} {
		if value := tokenDanceStringPath(root, path); strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
			return value
		}
	}
	outputs, _ := tokenDancePath(root, "data.0.outputs").([]any)
	for _, output := range outputs {
		if strings.EqualFold(tokenDanceStringPath(output, "type"), "video") {
			return tokenDanceStringPath(output, "url")
		}
	}
	return ""
}

func tokenDancePayloadError(payload []byte) string {
	var root any
	if len(payload) == 0 || json.Unmarshal(payload, &root) != nil {
		return ""
	}
	status := strings.ToLower(firstNonEmpty(
		tokenDanceStringPath(root, "status"),
		tokenDanceStringPath(root, "data.0.status"),
		tokenDanceStringPath(root, "output.task_status"),
		tokenDanceStringPath(root, "task.status"),
	))
	switch status {
	case "failed", "fail", "cancelled", "canceled", "expired", "violation", "unknown":
	default:
		return ""
	}
	return firstNonEmpty(
		tokenDanceStringPath(root, "error.message"),
		tokenDanceStringPath(root, "error"),
		tokenDanceStringPath(root, "data.0.error.message"),
		tokenDanceStringPath(root, "data.0.message"),
		tokenDanceStringPath(root, "output.message"),
		tokenDanceStringPath(root, "task.error.message"),
		tokenDanceStringPath(root, "message"),
		tokenDanceStringPath(root, "msg"),
		"TokenDance 任务执行失败",
	)
}
