package handler_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tigerowo/infinite-canvas/model"
)

var canvasAuthorityFields = []string{"team_id", "team_name", "can_edit", "can_manage_access"}

func canvasResponseData(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	requireTeamStatus(t, response, http.StatusOK, http.StatusCreated)
	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	return envelope.Data
}

func canvasListEntry(t *testing.T, f *teamHTTPFixture, id string) map[string]any {
	t.Helper()
	response := f.request(t, "team-owner", http.MethodGet, "/api/v1/canvas/projects", "")
	requireTeamStatus(t, response, http.StatusOK)
	var envelope struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	for _, project := range envelope.Data {
		if project["id"] == id {
			return project
		}
	}
	t.Fatalf("列表缺少画布 %s: %s", id, response.Body.String())
	return nil
}

func requireCanvasAuthority(t *testing.T, data map[string]any, teamID, teamName string, canEdit, canManage bool) {
	t.Helper()
	for key, want := range map[string]any{"team_id": teamID, "team_name": teamName, "can_edit": canEdit, "can_manage_access": canManage} {
		if data[key] != want {
			t.Errorf("%s = %v，期望 %v", key, data[key], want)
		}
	}
}

func requireStoredCanvasAuthorityAbsent(t *testing.T, f *teamHTTPFixture, id string) {
	t.Helper()
	var project model.CanvasProject
	if err := f.db.Where("id = ?", id).First(&project).Error; err != nil {
		t.Fatal(err)
	}
	var data map[string]any
	if err := json.Unmarshal([]byte(project.ProjectData), &data); err != nil {
		t.Fatal(err)
	}
	for _, key := range canvasAuthorityFields {
		if _, exists := data[key]; exists {
			t.Errorf("存储数据仍包含 %s: %s", key, project.ProjectData)
		}
	}
}

func TestCanvasDissolveAndMoveAuthority(t *testing.T) {
	f := newTeamHTTPFixture(t)
	teamID := f.createTeam(t)
	const id = "dissolve-move-canvas"
	raw := fmt.Sprintf(`{"id":%q,"title":"团队画布","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","team_id":%q,"team_name":"过期队名","can_edit":false,"can_manage_access":false,"nodes":[],"connections":[]}`, id, teamID)
	created := canvasResponseData(t, f.request(t, "team-owner", http.MethodPost, "/api/v1/canvas/projects", fmt.Sprintf(`{"team_id":%q,"data":%s}`, teamID, raw)))
	requireCanvasAuthority(t, created, teamID, "协作测试队", true, true)
	requireStoredCanvasAuthorityAbsent(t, f, id)

	// Simulate a document saved before server-owned fields were stripped.
	if err := f.db.Model(&model.CanvasProject{}).Where("id = ?", id).Update("project_data", raw).Error; err != nil {
		t.Fatal(err)
	}
	requireTeamStatus(t, f.request(t, "team-owner", http.MethodDelete, "/api/v1/teams/"+teamID, ""), http.StatusOK)
	requireCanvasAuthority(t, canvasListEntry(t, f, id), "", "", true, true)
	base := "/api/v1/canvas/projects/" + id
	snapshot := canvasResponseData(t, f.request(t, "team-owner", http.MethodGet, base+"/snapshot", ""))
	requireCanvasAuthority(t, snapshot["project_data"].(map[string]any), "", "", true, true)

	newTeamID := f.createTeam(t)
	requireTeamStatus(t, f.request(t, "team-owner", http.MethodPatch, "/api/v1/teams/"+newTeamID, `{"name":"新团队"}`), http.StatusOK)
	requireTeamStatus(t, f.request(t, "team-owner", http.MethodPost, base+"/move-to-team", fmt.Sprintf(`{"team_id":%q}`, newTeamID)), http.StatusOK)
	requireCanvasAuthority(t, canvasListEntry(t, f, id), newTeamID, "新团队", true, true)

	joinPermissionMember(t, f, newTeamID, "team-member")
	setPermissionRole(t, f, newTeamID, "team-member", "viewer")
	snapshot = canvasResponseData(t, f.request(t, "team-member", http.MethodGet, base+"/snapshot", ""))
	requireCanvasAuthority(t, snapshot["project_data"].(map[string]any), newTeamID, "新团队", false, false)
	// A retained history starting at revision 4 forces a changes reset.
	if err := f.db.Model(&model.CanvasProject{}).Where("id = ?", id).Update("revision", 4).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.db.Create(&model.CanvasChange{ProjectID: id, ProjectUserID: "team-owner", Revision: 4, UserID: "team-owner", Patch: `{}`}).Error; err != nil {
		t.Fatal(err)
	}
	reset := canvasResponseData(t, f.request(t, "team-member", http.MethodGet, base+"/changes?since=0", ""))
	if reset["reset"] != true {
		t.Fatal("预期 changes reset")
	}
	requireCanvasAuthority(t, reset["project_data"].(map[string]any), newTeamID, "新团队", false, false)
}

func TestCanvasPatchCannotOverrideAuthority(t *testing.T) {
	f := newTeamHTTPFixture(t)
	teamID := f.createTeam(t)
	const id = "authority-patch-canvas"
	createPermissionCanvas(t, f, teamID, "team-owner", id)
	base := "/api/v1/canvas/projects/" + id
	for _, operation := range []string{"set", "upsert"} {
		t.Run(operation, func(t *testing.T) {
			fields := map[string]any{}
			for _, key := range canvasAuthorityFields {
				if operation == "set" {
					fields[key] = "forged"
				} else {
					fields[key] = []map[string]any{{"id": "forged"}}
				}
			}
			// Include a real edit so the persisted history is checked too.
			patch := map[string]any{"set": map[string]any{"title": operation}, operation: fields}
			if operation == "set" {
				fields["title"] = operation
			}
			body, err := json.Marshal(map[string]any{"base_revision": 1, "patch": patch})
			if err != nil {
				t.Fatal(err)
			}
			requireTeamStatus(t, f.request(t, "team-owner", http.MethodPost, base+"/patches", string(body)), http.StatusOK)
			requireStoredCanvasAuthorityAbsent(t, f, id)
			requireCanvasAuthority(t, canvasListEntry(t, f, id), teamID, "协作测试队", true, true)
		})
	}
	changes := canvasResponseData(t, f.request(t, "team-owner", http.MethodGet, base+"/changes?since=1", ""))
	for _, change := range changes["changes"].([]any) {
		patch := change.(map[string]any)["patch"].(map[string]any)
		for _, operation := range []string{"set", "upsert", "delete"} {
			fields, _ := patch[operation].(map[string]any)
			for _, key := range canvasAuthorityFields {
				if _, exists := fields[key]; exists {
					t.Errorf("patch 历史 %s 仍包含 %s", operation, key)
				}
			}
		}
	}
	// Ignored metadata alone does not advance the revision.
	data := canvasResponseData(t, f.request(t, "team-owner", http.MethodPost, base+"/patches", `{"base_revision":3,"patch":{"set":{"team_id":"forged","can_edit":false}}}`))
	if data["revision"] != float64(3) {
		t.Fatalf("仅元数据 patch 改变修订号: %v", data)
	}
}

func TestPersonalCanvasWritesStripAuthority(t *testing.T) {
	f := newTeamHTTPFixture(t)
	for _, sync := range []bool{false, true} {
		id := fmt.Sprintf("personal-authority-%t", sync)
		raw := fmt.Sprintf(`{"id":%q,"title":"个人画布","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","team_id":"forged","team_name":"假团队","can_edit":false,"can_manage_access":false,"nodes":[{"id":"n1","team_id":"nested-content"}],"connections":[]}`, id)
		path, body := "/api/v1/canvas/projects", `{"data":`+raw+`}`
		if sync {
			path, body = path+"/sync", `{"projects":[`+raw+`]}`
		}
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodPost, path, body), http.StatusOK)
		requireStoredCanvasAuthorityAbsent(t, f, id)
		data := canvasListEntry(t, f, id)
		requireCanvasAuthority(t, data, "", "", true, true)
		if data["nodes"].([]any)[0].(map[string]any)["team_id"] != "nested-content" || data["title"] != "个人画布" {
			t.Fatal("剔除顶层字段不应改变画布内容")
		}
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodPost, "/api/v1/canvas/projects/"+id+"/patches", `{"base_revision":1,"patch":{"set":{"team_id":"forged","can_edit":false}}}`), http.StatusOK)
		requireCanvasAuthority(t, canvasListEntry(t, f, id), "", "", true, true)
	}
}
