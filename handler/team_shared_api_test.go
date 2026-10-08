package handler_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

// 测试身份：team-owner=owner；team-member=editor 且 can_use_team_api=true；team-member-2=editor 且 false；team-fill-00=viewer 且 true；team-outsider=非成员。

const (
	teamSharedChannelID = "owner-openai-channel"
	teamSharedAPIKey    = "sk-owner-secret-xyz"
)

func configureTeamSharedAPI(t *testing.T, f *teamHTTPFixture, baseURL string) {
	t.Helper()
	body := fmt.Sprintf(`{"config":{"localChannels":[{"id":%q,"protocol":"openai","name":"队长测试渠道","baseUrl":%q,"apiKey":%q,"models":["gpt-test"]}]}}`, teamSharedChannelID, baseURL, teamSharedAPIKey)
	requireTeamStatus(t, f.request(t, "team-owner", http.MethodPost, "/api/v1/user-config/model", body), http.StatusOK)
}

func setTeamSharedAPIMember(t *testing.T, f *teamHTTPFixture, teamID, userID string, role string, canUse bool) {
	t.Helper()
	if err := f.db.Model(&model.TeamMember{}).Where("team_id = ? AND user_id = ?", teamID, userID).Updates(map[string]any{"role": role, "can_use_team_api": canUse}).Error; err != nil {
		t.Fatalf("设置团队接口权限 %s: %v", userID, err)
	}
}

func openTeamSharedChannel(t *testing.T, f *teamHTTPFixture, teamID, userID string, channelIDs ...string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string][]string{"channel_ids": channelIDs})
	if err != nil {
		t.Fatal(err)
	}
	return f.request(t, userID, http.MethodPut, "/api/v1/teams/"+teamID+"/shared-channels", string(body))
}

func createTeamSharedCanvas(t *testing.T, f *teamHTTPFixture, teamID, canvasID string) {
	t.Helper()
	createPermissionCanvas(t, f, teamID, "team-owner", canvasID)
}

func createTeamSharedPersonalCanvas(t *testing.T, f *teamHTTPFixture, canvasID string) {
	t.Helper()
	body := fmt.Sprintf(`{"data":{"id":%q,"title":"个人画布","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","nodes":[],"connections":[]}}`, canvasID)
	requireTeamStatus(t, f.request(t, "team-owner", http.MethodPost, "/api/v1/canvas/projects", body), http.StatusOK, http.StatusCreated)
}

func TestTeamSharedChannelsAccessAndSecretSanitization(t *testing.T) {
	f := newTeamHTTPFixture(t)
	teamID := f.createTeam(t)
	joinPermissionMember(t, f, teamID, "team-member")
	joinPermissionMember(t, f, teamID, "team-member-2")
	joinPermissionMember(t, f, teamID, "team-fill-00")
	setTeamSharedAPIMember(t, f, teamID, "team-member", "editor", true)
	setTeamSharedAPIMember(t, f, teamID, "team-member-2", "editor", false)
	setTeamSharedAPIMember(t, f, teamID, "team-fill-00", "viewer", true)
	configureTeamSharedAPI(t, f, "http://127.0.0.1:1")

	// 验证开放渠道和取消开放只有 owner 可操作，成员不能修改开放列表。
	requireTeamStatus(t, openTeamSharedChannel(t, f, teamID, "team-member", teamSharedChannelID), http.StatusForbidden)
	requireTeamStatus(t, openTeamSharedChannel(t, f, teamID, "team-owner", "missing-channel"), http.StatusBadRequest)
	requireTeamStatus(t, openTeamSharedChannel(t, f, teamID, "team-owner", teamSharedChannelID), http.StatusOK)
	requireTeamStatus(t, openTeamSharedChannel(t, f, teamID, "team-member"), http.StatusForbidden)

	// 验证成员可读取开放渠道元数据，但响应不包含密钥和 baseURL，且 can_use 依成员开关返回。
	for _, tc := range []struct {
		userID string
		canUse bool
	}{
		{"team-owner", true},
		{"team-member", true},
		{"team-member-2", false},
		{"team-fill-00", true},
	} {
		response := f.request(t, tc.userID, http.MethodGet, "/api/v1/teams/"+teamID+"/shared-channels", "")
		requireTeamStatus(t, response, http.StatusOK)
		if bytes.Contains(response.Body.Bytes(), []byte(teamSharedAPIKey)) || bytes.Contains(response.Body.Bytes(), []byte("127.0.0.1:1")) || bytes.Contains(response.Body.Bytes(), []byte("baseURL")) || bytes.Contains(response.Body.Bytes(), []byte("baseUrl")) {
			t.Fatalf("渠道响应泄漏密钥或 baseURL: %s", response.Body.String())
		}
		var envelope struct {
			Data []struct {
				ChannelID string `json:"channel_id"`
				Name      string `json:"name"`
				Models    []struct {
					ID   string `json:"id"`
					Name string `json:"name"`
					Type string `json:"type"`
				} `json:"models"`
				CanUse bool `json:"can_use"`
			} `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
			t.Fatalf("解析共享渠道响应: %v; %s", err, response.Body.String())
		}
		if len(envelope.Data) != 1 || envelope.Data[0].ChannelID != teamSharedChannelID || envelope.Data[0].Name != "队长测试渠道" || envelope.Data[0].CanUse != tc.canUse {
			t.Fatalf("共享渠道元数据或 can_use 不正确: %s", response.Body.String())
		}
	}
	requireTeamStatus(t, f.request(t, "team-outsider", http.MethodGet, "/api/v1/teams/"+teamID+"/shared-channels", ""), http.StatusNotFound)
	// 验证空 channel_ids 可由 owner 取消全部开放渠道。
	requireTeamStatus(t, openTeamSharedChannel(t, f, teamID, "team-owner"), http.StatusOK)
	var canceled struct {
		Data []json.RawMessage `json:"data"`
	}
	response := f.request(t, "team-member", http.MethodGet, "/api/v1/teams/"+teamID+"/shared-channels", "")
	requireTeamStatus(t, response, http.StatusOK)
	if err := json.Unmarshal(response.Body.Bytes(), &canceled); err != nil {
		t.Fatalf("解析取消开放后的渠道列表: %v; %s", err, response.Body.String())
	}
	if len(canceled.Data) != 0 {
		t.Fatalf("取消开放后仍返回渠道: %s", response.Body.String())
	}
}

func TestTeamSharedChannelProxyAuthorizationAndCanvasScope(t *testing.T) {
	for _, tc := range []struct {
		name, userID, canvasID string
		want                   int
		open                   bool
	}{
		// 验证成员开关关闭时，即使是 editor 且画布可编辑也不能代发。
		{"无团队接口权限", "team-member-2", "shared-api-canvas", http.StatusForbidden, true},
		// 验证 viewer 的 can_use_team_api 为真仍不能绕过画布编辑权限。
		{"viewer 即使开关为真仍无画布编辑权", "team-fill-00", "shared-api-canvas", http.StatusForbidden, true},
		// 验证非成员访问代发接口时团队存在性不暴露。
		{"外人看不到团队", "team-outsider", "shared-api-canvas", http.StatusNotFound, true},
		// 验证个人画布不能作为团队接口代发的 canvas_id。
		{"个人画布不可代发", "team-member", "shared-api-personal", http.StatusForbidden, true},
		// 验证另一支团队的画布不能用于当前团队渠道代发。
		{"其他团队画布不可代发", "team-member", "shared-api-other-team", http.StatusForbidden, true},
		// 验证 owner 未开放的渠道不能被成员代发。
		{"渠道未开放", "team-member", "shared-api-canvas", http.StatusForbidden, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newTeamHTTPFixture(t)
			teamID := f.createTeam(t)
			joinPermissionMember(t, f, teamID, "team-member")
			joinPermissionMember(t, f, teamID, "team-member-2")
			joinPermissionMember(t, f, teamID, "team-fill-00")
			setTeamSharedAPIMember(t, f, teamID, "team-member", "editor", true)
			setTeamSharedAPIMember(t, f, teamID, "team-member-2", "editor", false)
			setTeamSharedAPIMember(t, f, teamID, "team-fill-00", "viewer", true)
			createTeamSharedCanvas(t, f, teamID, "shared-api-canvas")
			createTeamSharedPersonalCanvas(t, f, "shared-api-personal")
			otherTeamID := f.createTeam(t)
			createTeamSharedCanvas(t, f, otherTeamID, "shared-api-other-team")
			configureTeamSharedAPI(t, f, "http://127.0.0.1:1")
			if tc.open {
				requireTeamStatus(t, openTeamSharedChannel(t, f, teamID, "team-owner", teamSharedChannelID), http.StatusOK)
			}
			path := fmt.Sprintf("/api/v1/teams/%s/proxy/%s/v1/chat/completions?canvas_id=%s", teamID, teamSharedChannelID, url.QueryEscape(tc.canvasID))
			requireTeamStatus(t, f.request(t, tc.userID, http.MethodPost, path, `{"model":"gpt-test"}`), tc.want)
		})
	}
}

func TestTeamSharedChannelProxyForwardsAndRecordsUsage(t *testing.T) {
	for _, tc := range []struct {
		name       string
		upstream   int
		body       string
		wantStatus int
	}{
		{"透传成功响应", http.StatusCreated, `{"id":"upstream-ok","model":"gpt-test"}`, http.StatusCreated},
		{"透传上游 500 并记录用量", http.StatusInternalServerError, `{"error":"upstream failed"}`, http.StatusInternalServerError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var gotMethod, gotPath, gotAuth, gotContentType, gotBody string
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotMethod = r.Method
				gotPath = r.URL.RequestURI()
				gotAuth = r.Header.Get("Authorization")
				gotContentType = r.Header.Get("Content-Type")
				body, err := io.ReadAll(r.Body)
				if err != nil {
					t.Errorf("读取上游请求体: %v", err)
				}
				gotBody = string(body)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.upstream)
				_, _ = io.WriteString(w, tc.body)
			}))
			defer upstream.Close()

			f := newTeamHTTPFixture(t)
			teamID := f.createTeam(t)
			joinPermissionMember(t, f, teamID, "team-member")
			setTeamSharedAPIMember(t, f, teamID, "team-member", "editor", true)
			createTeamSharedCanvas(t, f, teamID, "shared-api-proxy-canvas")
			configureTeamSharedAPI(t, f, upstream.URL)
			requireTeamStatus(t, openTeamSharedChannel(t, f, teamID, "team-owner", teamSharedChannelID), http.StatusOK)

			// 验证代理保持原方法、path、普通查询参数、Content-Type 和请求体，只去掉 canvas_id，并用 owner 密钥鉴权。
			requestBody := "{\"model\":\"gpt-test\",\"messages\":[{\"role\":\"user\",\"content\":\"原样内容\"}]}"
			proxyURL := fmt.Sprintf("/api/v1/teams/%s/proxy/%s/v1/chat/completions?canvas_id=shared-api-proxy-canvas&trace=trace-144", teamID, teamSharedChannelID)
			proxy := f.request(t, "team-member", http.MethodPost, proxyURL, requestBody)
			if proxy.Code != tc.wantStatus || proxy.Body.String() != tc.body {
				t.Fatalf("成员收到的上游响应不一致，HTTP %d body=%q，期望 HTTP %d body=%q", proxy.Code, proxy.Body.String(), tc.wantStatus, tc.body)
			}
			if strings.Contains(proxy.Body.String(), teamSharedAPIKey) || proxy.Header().Get("Authorization") != "" {
				t.Fatalf("代理响应泄漏 owner 密钥: headers=%v body=%s", proxy.Header(), proxy.Body.String())
			}
			for name, values := range proxy.Header() {
				if strings.Contains(strings.Join(values, ","), teamSharedAPIKey) {
					t.Fatalf("代理响应头 %q 泄漏 owner 密钥: %v", name, values)
				}
			}
			if gotMethod != http.MethodPost || gotPath != "/v1/chat/completions?trace=trace-144" || gotAuth != "Bearer "+teamSharedAPIKey || gotContentType != "application/json" || gotBody != requestBody {
				t.Fatalf("上游请求未按约定转发: method=%q path=%q auth=%q content-type=%q body=%q", gotMethod, gotPath, gotAuth, gotContentType, gotBody)
			}

			// 验证每次代发（包括上游失败）均记用量，owner 可见成员显示名，成员不能查看。
			usage := f.request(t, "team-owner", http.MethodGet, "/api/v1/teams/"+teamID+"/api-usage", "")
			requireTeamStatus(t, usage, http.StatusOK)
			if !bytes.Contains(usage.Body.Bytes(), []byte("成员甲")) || !bytes.Contains(usage.Body.Bytes(), []byte(teamSharedChannelID)) || !bytes.Contains(usage.Body.Bytes(), []byte(fmt.Sprint(tc.wantStatus))) || bytes.Contains(usage.Body.Bytes(), []byte(teamSharedAPIKey)) {
				t.Fatalf("用量记录缺字段或泄漏密钥: %s", usage.Body.String())
			}
			requireTeamStatus(t, f.request(t, "team-member", http.MethodGet, "/api/v1/teams/"+teamID+"/api-usage", ""), http.StatusForbidden)
		})
	}
}

func TestTeamSharedChannelUsageKeepsLatest100(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{}`)
	}))
	defer upstream.Close()
	f := newTeamHTTPFixture(t)
	teamID := f.createTeam(t)
	joinPermissionMember(t, f, teamID, "team-member")
	setTeamSharedAPIMember(t, f, teamID, "team-member", "editor", true)
	createTeamSharedCanvas(t, f, teamID, "shared-api-usage-canvas")
	configureTeamSharedAPI(t, f, upstream.URL)
	requireTeamStatus(t, openTeamSharedChannel(t, f, teamID, "team-owner", teamSharedChannelID), http.StatusOK)

	// 验证用量记录只保留最近 100 条。
	proxyURL := fmt.Sprintf("/api/v1/teams/%s/proxy/%s/v1/chat/completions?canvas_id=shared-api-usage-canvas", teamID, teamSharedChannelID)
	for range 101 {
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPost, proxyURL, `{"model":"gpt-test"}`), http.StatusOK)
	}
	response := f.request(t, "team-owner", http.MethodGet, "/api/v1/teams/"+teamID+"/api-usage", "")
	requireTeamStatus(t, response, http.StatusOK)
	var envelope struct {
		Data []json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("解析用量列表: %v; %s", err, response.Body.String())
	}
	if len(envelope.Data) != 100 {
		t.Fatalf("用量记录数=%d，期望最近 100 条: %s", len(envelope.Data), response.Body.String())
	}
}
