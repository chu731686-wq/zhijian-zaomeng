package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"github.com/tigerowo/infinite-canvas/router"
	"github.com/tigerowo/infinite-canvas/service"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type teamHTTPFixture struct {
	router http.Handler
	tokens map[string]string
	db     *gorm.DB
}

func newTeamHTTPFixture(t *testing.T) *teamHTTPFixture {
	t.Helper()
	previous := config.Cfg
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:", AILogDir: t.TempDir(), UploadDir: t.TempDir(), JWTSecret: "team-collab-test-secret", JWTExpireHours: 1}
	t.Cleanup(func() { config.Cfg = previous })
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	resetTeamHTTPDatabase(t, db)
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() {
		var tables []string
		if err := db.Raw("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").Scan(&tables).Error; err != nil {
			t.Errorf("清理团队测试数据: %v", err)
			return
		}
		for _, table := range tables {
			quoted := `"` + strings.ReplaceAll(table, `"`, `""`) + `"`
			if err := db.Exec("DELETE FROM " + quoted).Error; err != nil {
				t.Errorf("清理团队测试表 %s: %v", table, err)
			}
		}
	})
	tokens := map[string]string{}
	for _, user := range []model.User{
		{ID: "team-owner", Username: "team-owner", DisplayName: "队长", Role: model.UserRoleUser, Status: model.UserStatusActive},
		{ID: "team-member", Username: "team-member", DisplayName: "成员甲", Role: model.UserRoleUser, Status: model.UserStatusActive},
		{ID: "team-member-2", Username: "team-member-2", DisplayName: "成员乙", Role: model.UserRoleUser, Status: model.UserStatusActive},
		{ID: "team-outsider", Username: "team-outsider", DisplayName: "外人", Role: model.UserRoleUser, Status: model.UserStatusActive},
	} {
		password, err := bcrypt.GenerateFromPassword([]byte("team-password"), bcrypt.MinCost)
		if err != nil {
			t.Fatal(err)
		}
		user.Password = string(password)
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
		session, err := service.Login(user.Username, "team-password")
		if err != nil {
			t.Fatal(err)
		}
		tokens[user.ID] = session.Token
	}
	for i := 0; i < 20; i++ {
		user := model.User{ID: fmt.Sprintf("team-fill-%02d", i), Username: fmt.Sprintf("team-fill-%02d", i), Role: model.UserRoleUser, Status: model.UserStatusActive}
		password, err := bcrypt.GenerateFromPassword([]byte("team-password"), bcrypt.MinCost)
		if err != nil {
			t.Fatal(err)
		}
		user.Password = string(password)
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
		session, err := service.Login(user.Username, "team-password")
		if err != nil {
			t.Fatal(err)
		}
		tokens[user.ID] = session.Token
	}
	return &teamHTTPFixture{router: router.New(), tokens: tokens, db: db}
}

func resetTeamHTTPDatabase(t *testing.T, db *gorm.DB) {
	t.Helper()
	var tables []string
	if err := db.Raw("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").Scan(&tables).Error; err != nil {
		t.Fatalf("重置团队测试数据库: %v", err)
	}
	for _, table := range tables {
		quoted := `"` + strings.ReplaceAll(table, `"`, `""`) + `"`
		if err := db.Exec("DELETE FROM " + quoted).Error; err != nil {
			t.Fatalf("重置团队测试表 %s: %v", table, err)
		}
	}
}

func (f *teamHTTPFixture) request(t *testing.T, userID, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	if userID != "" {
		req.Header.Set("Authorization", "Bearer "+f.tokens[userID])
	}
	response := httptest.NewRecorder()
	f.router.ServeHTTP(response, req)
	return response
}

func (f *teamHTTPFixture) uploadFile(t *testing.T, userID, filename, content string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	file, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/files", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+f.tokens[userID])
	response := httptest.NewRecorder()
	f.router.ServeHTTP(response, req)
	return response
}

func (f *teamHTTPFixture) createTeam(t *testing.T) string {
	t.Helper()
	response := f.request(t, "team-owner", http.MethodPost, "/api/v1/teams", `{"name":"协作测试队"}`)
	if response.Code != http.StatusOK && response.Code != http.StatusCreated {
		t.Fatalf("建队 HTTP %d: %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"id", "team_id"} {
		if id, ok := envelope.Data[key].(string); ok && id != "" {
			return id
		}
	}
	t.Fatalf("建队响应缺少团队 ID: %s", response.Body.String())
	return ""
}

func (f *teamHTTPFixture) invite(t *testing.T, teamID string) string {
	t.Helper()
	response := f.request(t, "team-owner", http.MethodPost, "/api/v1/teams/"+teamID+"/invites", `{}`)
	if response.Code/100 != 2 {
		t.Fatalf("生成邀请 HTTP %d: %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"token", "invite_token"} {
		if token, ok := envelope.Data[key].(string); ok && token != "" {
			return token
		}
	}
	t.Fatalf("邀请响应缺少 token: %s", response.Body.String())
	return ""
}

func requireTeamStatus(t *testing.T, response *httptest.ResponseRecorder, statuses ...int) {
	t.Helper()
	for _, status := range statuses {
		if response.Code == status {
			return
		}
	}
	t.Fatalf("HTTP %d: %s，期望 %v", response.Code, response.Body.String(), statuses)
}

// TestTeamCollabHTTPContracts 用 HTTP 层回归团队、邀请、画布增量与团队资产库的接口约定。
func TestTeamCollabHTTPContracts(t *testing.T) {
	const marker = "TEAM_COLLAB_HTTP_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestTeamCollabHTTPContracts$", "-test.timeout=80s")
		cmd.Env = append(os.Environ(), marker+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("隔离团队协作 HTTP 测试: %v\n%s", err, output)
		}
		return
	}
	f := newTeamHTTPFixture(t)

	t.Run("建队列表与非成员隐藏团队", func(t *testing.T) {
		// 验证建队后出现在列表中，成员可查看详情，非成员只能得到 404。
		teamID := f.createTeam(t)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodGet, "/api/v1/teams", ""), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodGet, "/api/v1/teams/"+teamID, ""), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-outsider", http.MethodGet, "/api/v1/teams/"+teamID, ""), http.StatusNotFound)
	})

	t.Run("邀请接受幂等过期撤销与满员", func(t *testing.T) {
		// 验证邀请预览、接受和重复接受幂等，并覆盖过期、撤销、20 人上限。
		teamID := f.createTeam(t)
		token := f.invite(t, teamID)
		requireTeamStatus(t, f.request(t, "team-outsider", http.MethodGet, "/api/v1/team-invites/"+token, ""), http.StatusOK)
		accept := "/api/v1/team-invites/" + token + "/accept"
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPost, accept, `{}`), http.StatusOK, http.StatusCreated)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPost, accept, `{}`), http.StatusOK)
		second := f.invite(t, teamID)
		revoke := f.request(t, "team-owner", http.MethodPost, "/api/v1/teams/"+teamID+"/invites/"+second+"/revoke", `{}`)
		requireTeamStatus(t, revoke, http.StatusOK, http.StatusNoContent)
		requireTeamStatus(t, f.request(t, "team-outsider", http.MethodPost, "/api/v1/team-invites/"+second+"/accept", `{}`), http.StatusBadRequest, http.StatusGone, http.StatusUnprocessableEntity)
		expired := f.invite(t, teamID)
		if err := f.db.Exec("UPDATE team_invites SET expires_at = ? WHERE token = ?", time.Now().Add(-time.Hour), expired).Error; err != nil {
			t.Fatalf("设置邀请过期: %v", err)
		}
		requireTeamStatus(t, f.request(t, "team-outsider", http.MethodPost, "/api/v1/team-invites/"+expired+"/accept", `{}`), http.StatusBadRequest, http.StatusGone, http.StatusUnprocessableEntity)
		fullTeam := f.createTeam(t)
		fullInvite := f.invite(t, fullTeam)
		for i := 0; i < 19; i++ {
			userID := fmt.Sprintf("team-fill-%02d", i)
			response := f.request(t, userID, http.MethodPost, "/api/v1/team-invites/"+fullInvite+"/accept", `{}`)
			requireTeamStatus(t, response, http.StatusOK, http.StatusCreated)
		}
		requireTeamStatus(t, f.request(t, "team-fill-19", http.MethodPost, "/api/v1/team-invites/"+fullInvite+"/accept", `{}`), http.StatusBadRequest, http.StatusConflict, http.StatusUnprocessableEntity)
	})

	t.Run("成员管理与解散画布归还", func(t *testing.T) {
		// 验证踢人、成员自行退出、owner 不可退出，以及解散后画布归属回到 owner。
		teamID := f.createTeam(t)
		token := f.invite(t, teamID)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPost, "/api/v1/team-invites/"+token+"/accept", `{}`), http.StatusOK, http.StatusCreated)
		token = f.invite(t, teamID)
		requireTeamStatus(t, f.request(t, "team-member-2", http.MethodPost, "/api/v1/team-invites/"+token+"/accept", `{}`), http.StatusOK, http.StatusCreated)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodDelete, "/api/v1/teams/"+teamID+"/members/team-owner", ""), http.StatusBadRequest, http.StatusForbidden)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodDelete, "/api/v1/teams/"+teamID+"/members/team-member", ""), http.StatusOK, http.StatusNoContent)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodDelete, "/api/v1/teams/"+teamID+"/members/team-member-2", ""), http.StatusOK, http.StatusNoContent)
		requireTeamStatus(t, f.request(t, "team-member-2", http.MethodGet, "/api/v1/teams/"+teamID, ""), http.StatusNotFound)
		canvas := f.request(t, "team-owner", http.MethodPost, "/api/v1/canvas/projects", `{"team_id":"`+teamID+`","data":{"id":"team-canvas","title":"团队画布","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","nodes":[],"connections":[]}}`)
		requireTeamStatus(t, canvas, http.StatusOK, http.StatusCreated)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodDelete, "/api/v1/teams/"+teamID, ""), http.StatusOK, http.StatusNoContent)
		projects := f.request(t, "team-owner", http.MethodGet, "/api/v1/canvas/projects", "")
		requireTeamStatus(t, projects, http.StatusOK)
		if !bytes.Contains(projects.Body.Bytes(), []byte(`"id":"team-canvas"`)) || bytes.Contains(projects.Body.Bytes(), []byte(`"team_id":"`+teamID+`"`)) {
			t.Errorf("解散后画布应回到 owner 个人名下: %s", projects.Body.String())
		}
	})

	t.Run("团队画布权限与移入", func(t *testing.T) {
		// 验证成员读写、外人和被踢成员 404、删除权限及个人画布移入团队。
		teamID := f.createTeam(t)
		invite := f.invite(t, teamID)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPost, "/api/v1/team-invites/"+invite+"/accept", `{}`), http.StatusOK, http.StatusCreated)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodPost, "/api/v1/canvas/projects", `{"team_id":"`+teamID+`","data":{"id":"shared-canvas","title":"共享画布","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","nodes":[],"connections":[]}}`), http.StatusOK, http.StatusCreated)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodGet, "/api/v1/canvas/projects/shared-canvas", ""), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-outsider", http.MethodGet, "/api/v1/canvas/projects/shared-canvas", ""), http.StatusNotFound)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPost, "/api/v1/canvas/projects/shared-canvas/patches", `{"base_revision":1,"patch":{"set":{"title":"成员修改"}}}`), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodDelete, "/api/v1/canvas/projects/shared-canvas", ""), http.StatusForbidden, http.StatusNotFound)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPost, "/api/v1/canvas/projects/delete", `{"ids":["shared-canvas"]}`), http.StatusForbidden, http.StatusNotFound)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodGet, "/api/v1/canvas/projects/shared-canvas", ""), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-outsider", http.MethodDelete, "/api/v1/canvas/projects/shared-canvas", ""), http.StatusNotFound)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPost, "/api/v1/canvas/projects/sync", `{"projects":[{"id":"shared-canvas","title":"共享画布","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","nodes":[],"connections":[]}]}`), http.StatusConflict)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodDelete, "/api/v1/teams/"+teamID+"/members/team-member", ""), http.StatusOK, http.StatusNoContent)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodGet, "/api/v1/canvas/projects/shared-canvas", ""), http.StatusNotFound)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodPost, "/api/v1/canvas/projects", `{"data":{"id":"move-me","title":"待移动画布","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","nodes":[],"connections":[]}}`), http.StatusOK, http.StatusCreated)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodPost, "/api/v1/canvas/projects/move-me/move-to-team", `{"team_id":"`+teamID+`"}`), http.StatusOK, http.StatusNoContent)
		invite = f.invite(t, teamID)
		requireTeamStatus(t, f.request(t, "team-member-2", http.MethodPost, "/api/v1/team-invites/"+invite+"/accept", `{}`), http.StatusOK, http.StatusCreated)
		requireTeamStatus(t, f.request(t, "team-member-2", http.MethodPost, "/api/v1/canvas/projects", `{"team_id":"`+teamID+`","data":{"id":"member-owned","title":"成员画布","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","nodes":[],"connections":[]}}`), http.StatusOK, http.StatusCreated)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodDelete, "/api/v1/canvas/projects/member-owned", ""), http.StatusOK, http.StatusNoContent)
	})

	t.Run("增量合并修订历史与在线成员", func(t *testing.T) {
		// 验证快照、浅合并、墓碑、set 替换、revision、他人变更、reset 与心跳在线列表。
		teamID := f.createTeam(t)
		token := f.invite(t, teamID)
		f.request(t, "team-member", http.MethodPost, "/api/v1/team-invites/"+token+"/accept", `{}`)
		project := f.request(t, "team-owner", http.MethodPost, "/api/v1/canvas/projects", `{"team_id":"`+teamID+`","data":{"id":"patch-canvas","title":"增量画布","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","nodes":[{"id":"n1","x":1,"y":1}],"connections":[]}}`)
		requireTeamStatus(t, project, http.StatusOK, http.StatusCreated)
		base := "/api/v1/canvas/projects/patch-canvas"
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodGet, base+"/snapshot", ""), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodPost, base+"/patches", `{"base_revision":1,"patch":{"upsert":{"nodes":[{"id":"n1","x":2}]}}}`), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPost, base+"/patches", `{"base_revision":1,"patch":{"upsert":{"nodes":[{"id":"n1","y":3}]}}}`), http.StatusOK)
		merged := f.request(t, "team-owner", http.MethodGet, base+"/snapshot", "")
		requireTeamStatus(t, merged, http.StatusOK)
		if !bytes.Contains(merged.Body.Bytes(), []byte(`"x":2`)) || !bytes.Contains(merged.Body.Bytes(), []byte(`"y":3`)) {
			t.Errorf("同一节点不同字段的浅合并应同时保留: %s", merged.Body.String())
		}
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodPost, base+"/patches", `{"base_revision":2,"patch":{"delete":{"nodes":["n1"]}}}`), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPost, base+"/patches", `{"base_revision":3,"patch":{"upsert":{"nodes":[{"id":"n1","x":9}]}}}`), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodPost, base+"/patches", `{"base_revision":4,"patch":{"set":{"edges":[{"id":"e1"}]}}}`), http.StatusOK)
		online := f.request(t, "team-member", http.MethodGet, base+"/changes?since=0&selected=n1", "")
		requireTeamStatus(t, online, http.StatusOK)
		if !bytes.Contains(online.Body.Bytes(), []byte("team-member")) {
			t.Errorf("在线列表应包含刚发起心跳的成员: %s", online.Body.String())
		}
		changes := f.request(t, "team-owner", http.MethodGet, base+"/changes?since=0", "")
		requireTeamStatus(t, changes, http.StatusOK)
		if !bytes.Contains(changes.Body.Bytes(), []byte("team-member")) {
			t.Errorf("changes 应包含其他成员的改动记录: %s", changes.Body.String())
		}
		snapshot := f.request(t, "team-owner", http.MethodGet, base+"/snapshot", "")
		requireTeamStatus(t, snapshot, http.StatusOK)
		if !bytes.Contains(snapshot.Body.Bytes(), []byte(`"revision":5`)) {
			t.Errorf("每次成功 patch 后 revision 应递增: %s", snapshot.Body.String())
		}
		if bytes.Contains(snapshot.Body.Bytes(), []byte(`"id":"n1"`)) || !bytes.Contains(snapshot.Body.Bytes(), []byte(`"edges":[{"id":"e1"}]`)) {
			t.Errorf("删除墓碑应忽略后续 upsert，且 set 应整体替换: %s", snapshot.Body.String())
		}
		for i := 0; i < 501; i++ {
			f.request(t, "team-owner", http.MethodPost, base+"/patches", `{"base_revision":1,"patch":{"set":{"counter":`+string(rune('0'+i%10))+`}}}`)
		}
		reset := f.request(t, "team-owner", http.MethodGet, base+"/changes?since=0", "")
		requireTeamStatus(t, reset, http.StatusOK)
		if !bytes.Contains(reset.Body.Bytes(), []byte(`"reset":true`)) {
			t.Errorf("超出保留范围时应返回 reset: %s", reset.Body.String())
		}
	})

	t.Run("团队文件与资产库权限", func(t *testing.T) {
		// 验证团队画布引用文件成员可读而外人不可读，并覆盖团队资产库增删改查权限。
		teamID := f.createTeam(t)
		token := f.invite(t, teamID)
		f.request(t, "team-member", http.MethodPost, "/api/v1/team-invites/"+token+"/accept", `{}`)
		uploaded := f.uploadFile(t, "team-owner", "team-file.txt", "team file access fixture")
		requireTeamStatus(t, uploaded, http.StatusOK, http.StatusCreated)
		var uploadedEnvelope struct {
			Data struct {
				ID         string `json:"id"`
				URL        string `json:"url"`
				StorageKey string `json:"storageKey"`
			} `json:"data"`
		}
		if err := json.Unmarshal(uploaded.Body.Bytes(), &uploadedEnvelope); err != nil {
			t.Fatal(err)
		}
		if uploadedEnvelope.Data.ID == "" || uploadedEnvelope.Data.URL == "" || uploadedEnvelope.Data.StorageKey == "" {
			t.Fatalf("文件上传响应缺少文件地址或 storageKey: %s", uploaded.Body.String())
		}
		canvasData := map[string]any{
			"id": "file-canvas", "title": "文件权限画布", "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
			"nodes":       []map[string]any{{"id": "file", "type": "image", "title": "上传文件", "position": map[string]int{"x": 0, "y": 0}, "metadata": map[string]string{"content": uploadedEnvelope.Data.URL, "storageKey": uploadedEnvelope.Data.StorageKey}}},
			"connections": []any{},
		}
		canvasBody, err := json.Marshal(map[string]any{"team_id": teamID, "data": canvasData})
		if err != nil {
			t.Fatal(err)
		}
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodPost, "/api/v1/canvas/projects", string(canvasBody)), http.StatusOK, http.StatusCreated)
		filePath := "/api/files/" + uploadedEnvelope.Data.ID + "/content"
		requireTeamStatus(t, f.request(t, "team-member", http.MethodGet, filePath, ""), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-outsider", http.MethodGet, filePath, ""), http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound)
		created := f.request(t, "team-member", http.MethodPost, "/api/v1/teams/"+teamID+"/assets", `{"kind":"text","name":"人物卡","category":"人物","text_content":"主角"}`)
		requireTeamStatus(t, created, http.StatusOK, http.StatusCreated)
		var envelope struct {
			Data map[string]any `json:"data"`
		}
		if err := json.Unmarshal(created.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		assetID, _ := envelope.Data["id"].(string)
		if assetID == "" {
			t.Fatalf("资产响应缺少 id: %s", created.Body.String())
		}
		requireTeamStatus(t, f.request(t, "team-member", http.MethodGet, "/api/v1/teams/"+teamID+"/assets?kind=text&category=%E4%BA%BA%E7%89%A9", ""), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPatch, "/api/v1/teams/"+teamID+"/assets/"+assetID, `{"name":"人物卡二","category":"道具"}`), http.StatusOK)
		secondCreated := f.request(t, "team-member", http.MethodPost, "/api/v1/teams/"+teamID+"/assets", `{"kind":"text","name":"owner 删除项","category":"人物","text_content":"owner 删除"}`)
		requireTeamStatus(t, secondCreated, http.StatusOK, http.StatusCreated)
		var secondEnvelope struct {
			Data map[string]any `json:"data"`
		}
		if err := json.Unmarshal(secondCreated.Body.Bytes(), &secondEnvelope); err != nil {
			t.Fatal(err)
		}
		ownerAssetID, _ := secondEnvelope.Data["id"].(string)
		if ownerAssetID == "" {
			t.Fatalf("第二条资产响应缺少 id: %s", secondCreated.Body.String())
		}
		requireTeamStatus(t, f.request(t, "team-member-2", http.MethodPost, "/api/v1/team-invites/"+f.invite(t, teamID)+"/accept", `{}`), http.StatusOK, http.StatusCreated)
		requireTeamStatus(t, f.request(t, "team-member-2", http.MethodDelete, "/api/v1/teams/"+teamID+"/assets/"+assetID, ""), http.StatusForbidden)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodDelete, "/api/v1/teams/"+teamID+"/assets/"+ownerAssetID, ""), http.StatusOK, http.StatusNoContent)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodDelete, "/api/v1/teams/"+teamID+"/assets/"+assetID, ""), http.StatusOK, http.StatusNoContent)
		requireTeamStatus(t, f.request(t, "team-outsider", http.MethodGet, "/api/v1/teams/"+teamID+"/assets", ""), http.StatusNotFound)
		requireTeamStatus(t, f.request(t, "team-outsider", http.MethodPatch, "/api/v1/teams/"+teamID+"/assets/asset-id", `{"name":"改名"}`), http.StatusNotFound)
		requireTeamStatus(t, f.request(t, "team-outsider", http.MethodDelete, "/api/v1/teams/"+teamID+"/assets/asset-id", ""), http.StatusNotFound)
	})
}
