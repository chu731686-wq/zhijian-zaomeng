package handler_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

func joinPermissionMember(t *testing.T, f *teamHTTPFixture, teamID, userID string) {
	t.Helper()
	token := f.invite(t, teamID)
	response := f.request(t, userID, http.MethodPost, "/api/v1/team-invites/"+token+"/accept", `{}`)
	requireTeamStatus(t, response, http.StatusOK, http.StatusCreated)
}

func setPermissionRole(t *testing.T, f *teamHTTPFixture, teamID, userID, role string) {
	t.Helper()
	if err := f.db.Exec("UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?", role, teamID, userID).Error; err != nil {
		t.Fatalf("设置成员身份 %s: %v", role, err)
	}
}

func createPermissionCanvas(t *testing.T, f *teamHTTPFixture, teamID, userID, canvasID string) {
	t.Helper()
	body := fmt.Sprintf(`{"team_id":%q,"data":{"id":%q,"title":"权限测试画布","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","nodes":[],"connections":[]}}`, teamID, canvasID)
	requireTeamStatus(t, f.request(t, userID, http.MethodPost, "/api/v1/canvas/projects", body), http.StatusOK, http.StatusCreated)
}

func createPermissionAsset(t *testing.T, f *teamHTTPFixture, teamID, userID, name string) string {
	t.Helper()
	body := fmt.Sprintf(`{"kind":"text","name":%q,"category":"人物","text_content":"权限测试"}`, name)
	response := f.request(t, userID, http.MethodPost, "/api/v1/teams/"+teamID+"/assets", body)
	requireTeamStatus(t, response, http.StatusOK, http.StatusCreated)
	var envelope struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Data.ID == "" {
		t.Fatalf("团队资产响应缺少 id: %s", response.Body.String())
	}
	return envelope.Data.ID
}

func TestTeamPermissionRoleMatrix(t *testing.T) {
	f := newTeamHTTPFixture(t)
	teamID := f.createTeam(t)
	joinPermissionMember(t, f, teamID, "team-member")
	joinPermissionMember(t, f, teamID, "team-member-2")
	joinPermissionMember(t, f, teamID, "team-fill-00")
	setPermissionRole(t, f, teamID, "team-member", "admin")
	setPermissionRole(t, f, teamID, "team-member-2", "editor")
	setPermissionRole(t, f, teamID, "team-fill-00", "viewer")
	createPermissionCanvas(t, f, teamID, "team-owner", "permission-matrix-canvas")

	for _, tc := range []struct {
		name      string
		userID    string
		role      string
		teamEdit  int
		canvasAdd int
		assetAdd  int
		invite    int
	}{
		{"owner", "team-owner", "owner", http.StatusOK, http.StatusOK, http.StatusOK, http.StatusOK},
		{"admin", "team-member", "admin", http.StatusOK, http.StatusOK, http.StatusOK, http.StatusOK},
		{"editor", "team-member-2", "editor", http.StatusForbidden, http.StatusOK, http.StatusOK, http.StatusForbidden},
		{"viewer", "team-fill-00", "viewer", http.StatusForbidden, http.StatusForbidden, http.StatusForbidden, http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// 验证权限表中每档身份的改队名、新建团队画布、放入团队资产和生成邀请权限。
			t.Run("改队名", func(t *testing.T) {
				response := f.request(t, tc.userID, http.MethodPatch, "/api/v1/teams/"+teamID, `{"name":"权限矩阵"}`)
				requireTeamStatus(t, response, tc.teamEdit)
			})
			t.Run("新建团队画布", func(t *testing.T) {
				body := fmt.Sprintf(`{"team_id":%q,"data":{"id":%q,"title":"新建权限","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","nodes":[],"connections":[]}}`, teamID, "matrix-"+tc.role)
				requireTeamStatus(t, f.request(t, tc.userID, http.MethodPost, "/api/v1/canvas/projects", body), tc.canvasAdd)
			})
			t.Run("新增团队资产", func(t *testing.T) {
				response := f.request(t, tc.userID, http.MethodPost, "/api/v1/teams/"+teamID+"/assets", `{"kind":"text","name":"权限项","category":"人物","text_content":"测试"}`)
				requireTeamStatus(t, response, tc.assetAdd)
			})
			t.Run("生成邀请", func(t *testing.T) {
				response := f.request(t, tc.userID, http.MethodPost, "/api/v1/teams/"+teamID+"/invites", `{"role":"viewer"}`)
				if tc.invite == http.StatusForbidden {
					requireTeamStatus(t, response, http.StatusForbidden)
				} else {
					requireTeamStatus(t, response, http.StatusOK, http.StatusCreated, http.StatusNoContent)
				}
			})
		})
	}
	// 验证非成员不能通过团队资源接口探测团队是否存在。
	requireTeamStatus(t, f.request(t, "team-outsider", http.MethodPatch, "/api/v1/teams/"+teamID, `{"name":"外人修改"}`), http.StatusNotFound)
	requireTeamStatus(t, f.request(t, "team-outsider", http.MethodPost, "/api/v1/teams/"+teamID+"/assets", `{"kind":"text","name":"外人","category":"其他"}`), http.StatusNotFound)
}

func TestTeamPermissionDeleteAndKickRoleMatrix(t *testing.T) {
	t.Run("删团队画布", func(t *testing.T) {
		for _, tc := range []struct {
			name, userID, role string
		}{
			{"owner", "team-owner", "owner"},
			{"admin", "team-member", "admin"},
			{"editor", "team-member-2", "editor"},
			{"viewer", "team-fill-00", "viewer"},
		} {
			t.Run(tc.name, func(t *testing.T) {
				f := newTeamHTTPFixture(t)
				teamID := f.createTeam(t)
				joinPermissionMember(t, f, teamID, "team-member")
				joinPermissionMember(t, f, teamID, "team-member-2")
				joinPermissionMember(t, f, teamID, "team-fill-00")
				setPermissionRole(t, f, teamID, "team-member", "admin")
				setPermissionRole(t, f, teamID, "team-member-2", "editor")
				setPermissionRole(t, f, teamID, "team-fill-00", "viewer")
				ownCanvas := "delete-own-" + tc.role
				otherCanvas := "delete-other-" + tc.role
				createPermissionCanvas(t, f, teamID, "team-member-2", ownCanvas)
				createPermissionCanvas(t, f, teamID, "team-owner", otherCanvas)
				deleteCanvas := func(canvasID string, statuses ...int) {
					response := f.request(t, tc.userID, http.MethodPost, "/api/v1/canvas/projects/delete", fmt.Sprintf(`{"ids":[%q]}`, canvasID))
					requireTeamStatus(t, response, statuses...)
				}
				switch tc.role {
				case "owner", "admin":
					deleteCanvas(ownCanvas, http.StatusOK, http.StatusCreated, http.StatusNoContent)
					deleteCanvas(otherCanvas, http.StatusOK, http.StatusCreated, http.StatusNoContent)
				case "editor":
					deleteCanvas(ownCanvas, http.StatusOK, http.StatusCreated, http.StatusNoContent)
					deleteCanvas(otherCanvas, http.StatusForbidden)
				case "viewer":
					deleteCanvas(otherCanvas, http.StatusForbidden)
				}
			})
		}
	})

	t.Run("删团队资产", func(t *testing.T) {
		for _, tc := range []struct {
			name, userID, role string
		}{
			{"owner", "team-owner", "owner"},
			{"admin", "team-member", "admin"},
			{"editor", "team-member-2", "editor"},
			{"viewer", "team-fill-00", "viewer"},
		} {
			t.Run(tc.name, func(t *testing.T) {
				f := newTeamHTTPFixture(t)
				teamID := f.createTeam(t)
				joinPermissionMember(t, f, teamID, "team-member")
				joinPermissionMember(t, f, teamID, "team-member-2")
				joinPermissionMember(t, f, teamID, "team-fill-00")
				setPermissionRole(t, f, teamID, "team-member", "admin")
				setPermissionRole(t, f, teamID, "team-member-2", "editor")
				setPermissionRole(t, f, teamID, "team-fill-00", "viewer")
				ownAsset := createPermissionAsset(t, f, teamID, "team-member-2", "自己创建的资产")
				otherAsset := createPermissionAsset(t, f, teamID, "team-owner", "他人创建的资产")
				deleteAsset := func(assetID string, statuses ...int) {
					response := f.request(t, tc.userID, http.MethodDelete, "/api/v1/teams/"+teamID+"/assets/"+assetID, "")
					requireTeamStatus(t, response, statuses...)
				}
				switch tc.role {
				case "owner", "admin":
					deleteAsset(ownAsset, http.StatusOK, http.StatusCreated, http.StatusNoContent)
					deleteAsset(otherAsset, http.StatusOK, http.StatusCreated, http.StatusNoContent)
				case "editor":
					deleteAsset(ownAsset, http.StatusOK, http.StatusCreated, http.StatusNoContent)
					deleteAsset(otherAsset, http.StatusForbidden)
				case "viewer":
					deleteAsset(otherAsset, http.StatusForbidden)
				}
			})
		}
	})

	t.Run("踢人", func(t *testing.T) {
		for _, tc := range []struct {
			name, userID, role string
		}{
			{"owner", "team-owner", "owner"},
			{"admin", "team-member", "admin"},
			{"editor", "team-member-2", "editor"},
			{"viewer", "team-fill-00", "viewer"},
		} {
			t.Run(tc.name, func(t *testing.T) {
				f := newTeamHTTPFixture(t)
				teamID := f.createTeam(t)
				for _, userID := range []string{"team-member", "team-member-2", "team-fill-00"} {
					joinPermissionMember(t, f, teamID, userID)
				}
				setPermissionRole(t, f, teamID, "team-member", "admin")
				setPermissionRole(t, f, teamID, "team-member-2", "editor")
				setPermissionRole(t, f, teamID, "team-fill-00", "viewer")
				kick := func(target string, statuses ...int) {
					response := f.request(t, tc.userID, http.MethodDelete, "/api/v1/teams/"+teamID+"/members/"+target, "")
					requireTeamStatus(t, response, statuses...)
				}
				switch tc.role {
				case "owner":
					for _, target := range []string{"team-member", "team-member-2", "team-fill-00"} {
						kick(target, http.StatusOK, http.StatusCreated, http.StatusNoContent)
					}
				case "admin":
					kick("team-member-2", http.StatusOK, http.StatusCreated, http.StatusNoContent)
					kick("team-fill-00", http.StatusOK, http.StatusCreated, http.StatusNoContent)
					kick("team-owner", http.StatusForbidden)
				case "editor", "viewer":
					kick("team-owner", http.StatusForbidden)
				}
			})
		}
	})
}

func TestTeamPermissionMemberExitRoleMatrix(t *testing.T) {
	t.Run("owner 不能自行退出", func(t *testing.T) {
		f := newTeamHTTPFixture(t)
		teamID := f.createTeam(t)
		response := f.request(t, "team-owner", http.MethodDelete, "/api/v1/teams/"+teamID+"/members/team-owner", "")
		requireTeamStatus(t, response, http.StatusForbidden, http.StatusBadRequest)
	})

	for _, tc := range []struct {
		name, userID, role string
	}{
		{"admin", "team-member", "admin"},
		{"editor", "team-member-2", "editor"},
		{"viewer", "team-fill-00", "viewer"},
	} {
		t.Run(tc.name+" 自行退出", func(t *testing.T) {
			f := newTeamHTTPFixture(t)
			teamID := f.createTeam(t)
			joinPermissionMember(t, f, teamID, tc.userID)
			setPermissionRole(t, f, teamID, tc.userID, tc.role)
			response := f.request(t, tc.userID, http.MethodDelete, "/api/v1/teams/"+teamID+"/members/"+tc.userID, "")
			requireTeamStatus(t, response, http.StatusOK, http.StatusNoContent)
		})
	}
}

func TestTeamPermissionInviteRoleAndMemberFields(t *testing.T) {
	f := newTeamHTTPFixture(t)
	teamID := f.createTeam(t)

	// 验证 owner 可生成 viewer 邀请，接受后身份为 viewer，成员列表包含 role 和 can_use_team_api。
	created := f.request(t, "team-owner", http.MethodPost, "/api/v1/teams/"+teamID+"/invites", `{"role":"viewer"}`)
	requireTeamStatus(t, created, http.StatusOK, http.StatusCreated)
	var inviteEnvelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &inviteEnvelope); err != nil {
		t.Fatal(err)
	}
	token, _ := inviteEnvelope.Data["token"].(string)
	if token == "" {
		t.Fatalf("viewer 邀请响应缺少 token: %s", created.Body.String())
	}
	requireTeamStatus(t, f.request(t, "team-member", http.MethodPost, "/api/v1/team-invites/"+token+"/accept", `{}`), http.StatusOK, http.StatusCreated)
	var role string
	if err := f.db.Raw("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?", teamID, "team-member").Scan(&role).Error; err != nil {
		t.Fatal(err)
	}
	if role != "viewer" {
		t.Errorf("接受 viewer 邀请后身份=%q，期望 viewer", role)
	}
	members := f.request(t, "team-owner", http.MethodGet, "/api/v1/teams/"+teamID, "")
	requireTeamStatus(t, members, http.StatusOK)
	if !bytes.Contains(members.Body.Bytes(), []byte(`"role":"viewer"`)) || !bytes.Contains(members.Body.Bytes(), []byte(`"can_use_team_api":false`)) {
		t.Errorf("成员列表应包含 role 和默认关闭的 can_use_team_api: %s", members.Body.String())
	}
}

func TestTeamPermissionRoleChangesTransferAndDissolve(t *testing.T) {
	f := newTeamHTTPFixture(t)
	teamID := f.createTeam(t)
	for _, userID := range []string{"team-member", "team-member-2", "team-fill-00"} {
		joinPermissionMember(t, f, teamID, userID)
	}
	setPermissionRole(t, f, teamID, "team-member", "admin")
	setPermissionRole(t, f, teamID, "team-member-2", "editor")
	setPermissionRole(t, f, teamID, "team-fill-00", "viewer")

	t.Run("管理员改 editor 与 viewer", func(t *testing.T) {
		// 验证 admin 能在 editor 与 viewer 之间调整身份，且不能任命 admin 或触碰 owner、其他 admin。
		path := "/api/v1/teams/" + teamID + "/members/team-member-2"
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPatch, path, `{"role":"viewer"}`), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPatch, path, `{"role":"editor"}`), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPatch, "/api/v1/teams/"+teamID+"/members/team-fill-00", `{"role":"admin"}`), http.StatusForbidden)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPatch, "/api/v1/teams/"+teamID+"/members/team-owner", `{"role":"viewer"}`), http.StatusForbidden)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPatch, "/api/v1/teams/"+teamID+"/members/team-member", `{"role":"editor"}`), http.StatusForbidden)
	})
	t.Run("owner 任命管理员并转让队长", func(t *testing.T) {
		// 验证 owner 能任命 admin；转让后原 owner 为 admin、新 owner 能解散团队。
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodPatch, "/api/v1/teams/"+teamID+"/members/team-member-2", `{"role":"admin"}`), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodPost, "/api/v1/teams/"+teamID+"/transfer", `{"user_id":"team-member-2"}`), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodPatch, "/api/v1/teams/"+teamID+"/members/team-fill-00", `{"role":"editor"}`), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-member-2", http.MethodDelete, "/api/v1/teams/"+teamID, ""), http.StatusOK, http.StatusNoContent)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodGet, "/api/v1/teams/"+teamID, ""), http.StatusNotFound)
	})
}

func TestTeamPermissionCanUseTeamAPI(t *testing.T) {
	f := newTeamHTTPFixture(t)
	teamID := f.createTeam(t)
	joinPermissionMember(t, f, teamID, "team-member")

	// 验证 can_use_team_api 默认 false，owner 可开关，admin 和其他成员不能改。
	members := f.request(t, "team-owner", http.MethodGet, "/api/v1/teams/"+teamID, "")
	requireTeamStatus(t, members, http.StatusOK)
	if !bytes.Contains(members.Body.Bytes(), []byte(`"can_use_team_api":false`)) {
		t.Errorf("新成员的 can_use_team_api 应默认 false: %s", members.Body.String())
	}
	path := "/api/v1/teams/" + teamID + "/members/team-member"
	requireTeamStatus(t, f.request(t, "team-owner", http.MethodPatch, path, `{"can_use_team_api":true}`), http.StatusOK)
	requireTeamStatus(t, f.request(t, "team-member", http.MethodPatch, path, `{"can_use_team_api":false}`), http.StatusForbidden)
	requireTeamStatus(t, f.request(t, "team-owner", http.MethodPatch, path, `{"can_use_team_api":false}`), http.StatusOK)
}

func TestTeamPermissionViewerReadOnlyAndCreationRestrictions(t *testing.T) {
	f := newTeamHTTPFixture(t)
	teamID := f.createTeam(t)
	joinPermissionMember(t, f, teamID, "team-member")
	setPermissionRole(t, f, teamID, "team-member", "viewer")
	createPermissionCanvas(t, f, teamID, "team-owner", "viewer-canvas")
	base := "/api/v1/canvas/projects/viewer-canvas"

	// 验证 viewer 可拉 snapshot/changes，但 patches、新建團队画布和放素材进团队资产库均为 403。
	requireTeamStatus(t, f.request(t, "team-member", http.MethodGet, base+"/snapshot", ""), http.StatusOK)
	requireTeamStatus(t, f.request(t, "team-member", http.MethodGet, base+"/changes?since=0", ""), http.StatusOK)
	requireTeamStatus(t, f.request(t, "team-member", http.MethodPost, base+"/patches", `{"base_revision":1,"patch":{"set":{"title":"不可编辑"}}}`), http.StatusForbidden)
	requireTeamStatus(t, f.request(t, "team-member", http.MethodPost, "/api/v1/canvas/projects", `{"team_id":"`+teamID+`","data":{"id":"viewer-create","title":"禁止创建","nodes":[],"connections":[]}}`), http.StatusForbidden)
	requireTeamStatus(t, f.request(t, "team-member", http.MethodPost, "/api/v1/teams/"+teamID+"/assets", `{"kind":"text","name":"禁止放入","category":"人物","text_content":"x"}`), http.StatusForbidden)
}

func TestCanvasPermissionCustomAccess(t *testing.T) {
	f := newTeamHTTPFixture(t)
	teamID := f.createTeam(t)
	for _, userID := range []string{"team-member", "team-member-2", "team-fill-00"} {
		joinPermissionMember(t, f, teamID, userID)
	}
	setPermissionRole(t, f, teamID, "team-member-2", "viewer")
	setPermissionRole(t, f, teamID, "team-fill-00", "admin")
	createPermissionCanvas(t, f, teamID, "team-member", "custom-canvas")
	base := "/api/v1/canvas/projects/custom-canvas"

	t.Run("custom 名单隔离与 viewer 权限上限", func(t *testing.T) {
		// 验证 custom 名单外 editor 不可见；viewer 即使名单标 edit 也只能看；admin 移出名单后仍可读写。
		joinPermissionMember(t, f, teamID, "team-fill-01")
		setPermissionRole(t, f, teamID, "team-fill-01", "editor")
		access := f.request(t, "team-member", http.MethodPut, base+"/access", `{"mode":"custom","members":[{"user_id":"team-member-2","permission":"view"}]}`)
		requireTeamStatus(t, access, http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-fill-01", http.MethodGet, base, ""), http.StatusNotFound)
		requireTeamStatus(t, f.request(t, "team-fill-01", http.MethodGet, base+"/snapshot", ""), http.StatusNotFound)
		requireTeamStatus(t, f.request(t, "team-fill-01", http.MethodGet, base+"/changes?since=0", ""), http.StatusNotFound)
		requireTeamStatus(t, f.request(t, "team-member-2", http.MethodGet, base, ""), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-member-2", http.MethodGet, base+"/snapshot", ""), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-member-2", http.MethodPost, base+"/patches", `{"base_revision":1,"patch":{"set":{"title":"只读"}}}`), http.StatusForbidden)
		access = f.request(t, "team-member", http.MethodPut, base+"/access", `{"mode":"custom","members":[{"user_id":"team-member-2","permission":"edit"},{"user_id":"team-fill-00","permission":"edit"}]}`)
		requireTeamStatus(t, access, http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-member-2", http.MethodPost, base+"/patches", `{"base_revision":1,"patch":{"set":{"title":"viewer 即使名单标 edit 仍不可改"}}}`), http.StatusForbidden)
		requireTeamStatus(t, f.request(t, "team-fill-00", http.MethodPost, base+"/patches", `{"base_revision":1,"patch":{"set":{"title":"admin 可改"}}}`), http.StatusOK)
		access = f.request(t, "team-member", http.MethodPut, base+"/access", `{"mode":"custom","members":[{"user_id":"team-member-2","permission":"view"}]}`)
		requireTeamStatus(t, access, http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodGet, base, ""), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-fill-00", http.MethodGet, base, ""), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-fill-00", http.MethodPost, base+"/patches", `{"base_revision":2,"patch":{"set":{"title":"admin 移出名单仍可改"}}}`), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodGet, base, ""), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPost, base+"/patches", `{"base_revision":3,"patch":{"set":{"title":"创建者可改"}}}`), http.StatusOK)
	})
	t.Run("画布权限管理人", func(t *testing.T) {
		// 验证只有画布创建者、admin 和 owner 能改单张画布权限，editor 与 viewer 被拒绝。
		body := `{"mode":"team","members":[]}`
		requireTeamStatus(t, f.request(t, "team-owner", http.MethodPut, base+"/access", body), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-fill-00", http.MethodPut, base+"/access", body), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-member", http.MethodPut, base+"/access", body), http.StatusOK)
		requireTeamStatus(t, f.request(t, "team-member-2", http.MethodPut, base+"/access", body), http.StatusForbidden)
	})
}

func TestCanvasPermissionTeamModeAndMembershipDefaults(t *testing.T) {
	f := newTeamHTTPFixture(t)
	teamID := f.createTeam(t)
	joinPermissionMember(t, f, teamID, "team-member")
	joinPermissionMember(t, f, teamID, "team-member-2")
	setPermissionRole(t, f, teamID, "team-member", "viewer")
	createPermissionCanvas(t, f, teamID, "team-owner", "team-mode-canvas")
	base := "/api/v1/canvas/projects/team-mode-canvas"

	// 验证 team 模式遵循成员身份：viewer 只读，editor 可改；画布创建者和 owner 始终可访问。
	requireTeamStatus(t, f.request(t, "team-member", http.MethodGet, base+"/snapshot", ""), http.StatusOK)
	requireTeamStatus(t, f.request(t, "team-member", http.MethodPost, base+"/patches", `{"base_revision":1,"patch":{"set":{"title":"viewer"}}}`), http.StatusForbidden)
	requireTeamStatus(t, f.request(t, "team-member-2", http.MethodPost, base+"/patches", `{"base_revision":1,"patch":{"set":{"title":"editor"}}}`), http.StatusOK)
	requireTeamStatus(t, f.request(t, "team-owner", http.MethodGet, base, ""), http.StatusOK)
	// 验证 custom 模式下创建者仍可读写，且没有成员身份变更会剥夺 owner 的访问权。
	requireTeamStatus(t, f.request(t, "team-owner", http.MethodPut, base+"/access", `{"mode":"custom","members":[]}`), http.StatusOK)
	requireTeamStatus(t, f.request(t, "team-owner", http.MethodGet, base, ""), http.StatusOK)
	requireTeamStatus(t, f.request(t, "team-owner", http.MethodPost, base+"/patches", `{"base_revision":2,"patch":{"set":{"title":"owner"}}}`), http.StatusOK)
	// 验证非成员在任意画布权限模式下仍得到 404。
	requireTeamStatus(t, f.request(t, "team-outsider", http.MethodGet, base+"/snapshot", ""), http.StatusNotFound)
}
