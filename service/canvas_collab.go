package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

// Call under collabMu so a removed member cannot write using stale authorization.
func canvasAccess(userID, id string) (model.CanvasProject, error) {
	projects, err := repository.FindCanvasProjects(strings.TrimSpace(id))
	if err != nil {
		return model.CanvasProject{}, err
	}
	// Prefer the user's personal project if another user chose the same ID.
	for _, personal := range []bool{true, false} {
		for _, project := range projects {
			if (project.TeamID == nil) != personal || project.DeletedAt != "" {
				continue
			}
			permissions, err := collaborationPermissions(userID, "", &project, "")
			if err == nil {
				project.TeamName = permissions.Team.Name
				project.CanEdit, project.CanManageAccess = permissions.CanEdit, permissions.CanManageAccess
				return project, nil
			}
			var ce *CollabError
			if !errors.As(err, &ce) || ce.Status != 404 {
				return project, err
			}
		}
	}
	return model.CanvasProject{}, collabError(404, "画布项目不存在")
}

var canvasServerFields = [...]string{"team_id", "team_name", "can_edit", "can_manage_access"}

func canvasPayload(project model.CanvasProject) json.RawMessage {
	var data map[string]json.RawMessage
	if json.Unmarshal([]byte(project.ProjectData), &data) != nil || data == nil {
		return json.RawMessage(project.ProjectData)
	}
	teamID, teamName := "", ""
	if project.TeamID != nil {
		teamID, teamName = *project.TeamID, project.TeamName
	}
	data["team_id"], _ = json.Marshal(teamID)
	data["team_name"], _ = json.Marshal(teamName)
	data["can_edit"], _ = json.Marshal(project.CanEdit)
	data["can_manage_access"], _ = json.Marshal(project.CanManageAccess)
	raw, _ := json.Marshal(data)
	return raw
}
func GetCurrentCanvasProject(ctx context.Context, id string) (json.RawMessage, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return nil, err
	}
	project, err := canvasAccess(user.ID, id)
	if err != nil {
		return nil, err
	}
	return canvasPayload(project), nil
}
func SaveCurrentTeamCanvasProject(ctx context.Context, teamID string, raw json.RawMessage) (json.RawMessage, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return nil, err
	}
	permissions, err := collaborationPermissions(user.ID, teamID, nil, "")
	team := permissions.Team
	if err != nil {
		return nil, err
	}
	if err := requireCollabPermission(permissions.CanEdit); err != nil {
		return nil, err
	}
	project, err := canvasProjectFromRaw(user.ID, raw)
	if err != nil {
		return nil, err
	}
	existing, err := repository.FindCanvasProjects(project.ID)
	if err != nil {
		return nil, err
	}
	if len(existing) != 0 {
		return nil, collabError(409, "画布已存在，请使用增量同步或移入团队")
	}
	project.TeamID = &team.ID
	project.Revision = 1
	project.TeamName = team.Name
	saved, err := repository.SaveUserCanvasProject(project)
	if err != nil {
		return nil, err
	}
	saved.CanEdit, saved.CanManageAccess = true, true
	return canvasPayload(saved), nil
}
func MoveCurrentCanvasToTeam(ctx context.Context, id, teamID string) error {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return err
	}
	permissions, err := collaborationPermissions(user.ID, teamID, nil, "")
	if err != nil {
		return err
	}
	if err := requireCollabPermission(permissions.CanEdit); err != nil {
		return err
	}
	project, err := canvasAccess(user.ID, id)
	if err != nil {
		return err
	}
	if project.UserID != user.ID || project.TeamID != nil {
		return collabError(403, "只能移入自己创建的个人画布")
	}
	return repository.MoveCanvasToTeam(project, teamID)
}
func canvasDeletePermission(userID string, project model.CanvasProject) error {
	permissions, err := collaborationPermissions(userID, "", &project, "")
	if err != nil {
		return err
	}
	return requireCollabPermission(permissions.CanDelete)
}
func DeleteCurrentCanvasProject(ctx context.Context, id string) error {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return err
	}
	project, err := canvasAccess(user.ID, id)
	if err != nil {
		return err
	}
	if err = canvasDeletePermission(user.ID, project); err != nil {
		return err
	}
	return repository.DeleteCanvasProject(project, time.Now().UTC().Format(time.RFC3339Nano))
}

// Legacy whole-document writes must never overwrite a shared project, even without team_id.
func checkPersonalCanvasWrite(userID, id string) error {
	projects, err := repository.FindCanvasProjects(id)
	if err != nil {
		return err
	}
	for _, p := range projects {
		if p.UserID == userID && p.TeamID == nil {
			// Deleted personal records remain idempotent tombstones.
			if p.DeletedAt != "" {
				return nil
			}
			permissions, err := collaborationPermissions(userID, "", &p, "")
			if err != nil {
				return err
			}
			return requireCollabPermission(permissions.CanEdit)
		}
	}
	for _, p := range projects {
		if p.TeamID != nil {
			if _, err = collaborationPermissions(userID, "", &p, ""); err != nil {
				return err
			}
			return collabError(409, "团队画布请使用增量同步")
		}
	}
	return nil
}

type CanvasPatch struct {
	Set    map[string]any              `json:"set"`
	Upsert map[string][]map[string]any `json:"upsert"`
	Delete map[string][]string         `json:"delete"`
}
type CanvasSnapshot struct {
	ProjectData     json.RawMessage `json:"project_data"`
	Revision        int64           `json:"revision"`
	CanEdit         bool            `json:"can_edit"`
	CanManageAccess bool            `json:"can_manage_access"`
}

func CurrentCanvasSnapshot(ctx context.Context, id string) (CanvasSnapshot, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return CanvasSnapshot{}, err
	}
	p, err := canvasAccess(user.ID, id)
	if err != nil {
		return CanvasSnapshot{}, err
	}
	return CanvasSnapshot{ProjectData: canvasPayload(p), Revision: p.Revision, CanEdit: p.CanEdit, CanManageAccess: p.CanManageAccess}, nil
}
func collection(data map[string]any, key string) ([]any, error) {
	value, exists := data[key]
	if !exists {
		return []any{}, nil
	}
	items, ok := value.([]any)
	if !ok {
		return nil, collabError(400, "增量集合须为带id对象的数组")
	}
	for _, item := range items {
		obj, ok := item.(map[string]any)
		if !ok {
			return nil, collabError(400, "增量集合须为带id对象的数组")
		}
		if id, ok := obj["id"].(string); !ok || id == "" {
			return nil, collabError(400, "集合元素缺少id")
		}
	}
	return items, nil
}
func ApplyCurrentCanvasPatch(ctx context.Context, id string, baseRevision int64, patch CanvasPatch) (any, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return nil, err
	}
	p, err := canvasAccess(user.ID, id)
	if err != nil {
		return nil, err
	}
	if err := requireCollabPermission(p.CanEdit); err != nil {
		return nil, err
	}
	if baseRevision < 1 || baseRevision > p.Revision {
		return nil, collabError(400, "基础修订号无效")
	}
	var data map[string]any
	if json.Unmarshal([]byte(p.ProjectData), &data) != nil || data == nil {
		return nil, collabError(400, "画布数据无效")
	}
	before, _ := json.Marshal(data)
	for _, key := range canvasServerFields {
		delete(data, key)
		delete(patch.Set, key)
		delete(patch.Upsert, key)
		delete(patch.Delete, key)
	}
	tombs := map[string]map[string]bool{}
	if p.Tombstones != "" {
		if err = json.Unmarshal([]byte(p.Tombstones), &tombs); err != nil {
			return nil, err
		}
	}
	// set first, then upsert, then delete; deletion always wins within a patch.
	for key, value := range patch.Set {
		if key != "viewport" {
			data[key] = value
		}
	}
	for key, updates := range patch.Upsert {
		if key == "viewport" {
			continue
		}
		items, err := collection(data, key)
		if err != nil {
			return nil, err
		}
		for _, update := range updates {
			itemID, ok := update["id"].(string)
			if !ok || itemID == "" {
				return nil, collabError(400, "集合元素缺少id")
			}
			if tombs[key][itemID] {
				continue
			}
			found := false
			for _, item := range items {
				obj := item.(map[string]any)
				if obj["id"] == itemID {
					for field, value := range update {
						obj[field] = value
					}
					found = true
					break
				}
			}
			if !found {
				items = append(items, update)
			}
		}
		if _, exists := data[key]; exists || len(items) > 0 {
			data[key] = items
		}
	}
	for key, ids := range patch.Delete {
		if key == "viewport" {
			continue
		}
		items, err := collection(data, key)
		if err != nil {
			return nil, err
		}
		if tombs[key] == nil {
			tombs[key] = map[string]bool{}
		}
		for _, itemID := range ids {
			if itemID == "" {
				return nil, collabError(400, "删除元素缺少id")
			}
			tombs[key][itemID] = true
		}
		kept := []any{}
		for _, item := range items {
			if !tombs[key][item.(map[string]any)["id"].(string)] {
				kept = append(kept, item)
			}
		}
		if _, exists := data[key]; exists {
			data[key] = kept
		}
	}
	after, _ := json.Marshal(data)
	tombJSON, _ := json.Marshal(tombs)
	if bytes.Equal(before, after) {
		if p.Tombstones != string(tombJSON) {
			err = repository.SaveCanvasTombstones(p, string(tombJSON))
		}
		return map[string]any{"revision": p.Revision}, err
	}
	p.ProjectData = string(after)
	p.Tombstones = string(tombJSON)
	p.Revision++
	p.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	// Preserve only shared fields in history as well as in project_data.
	delete(patch.Set, "viewport")
	delete(patch.Upsert, "viewport")
	delete(patch.Delete, "viewport")
	raw, err := json.Marshal(patch)
	if err != nil {
		return nil, err
	}
	err = repository.SaveCanvasPatch(p, model.CanvasChange{ProjectID: p.ID, ProjectUserID: p.UserID, Revision: p.Revision, UserID: user.ID, Patch: string(raw), CreatedAt: time.Now().UTC()})
	return map[string]any{"revision": p.Revision}, err
}

type canvasPresence struct {
	At       time.Time
	Selected []string
}

var canvasOnline = map[string]map[string]canvasPresence{}

func CurrentCanvasChanges(ctx context.Context, id string, since int64, selected string) (any, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return nil, err
	}
	p, err := canvasAccess(user.ID, id)
	if err != nil {
		return nil, err
	}
	if since < 0 {
		return nil, collabError(400, "修订号无效")
	}
	key := p.UserID + "/" + p.ID
	now := time.Now()
	if canvasOnline[key] == nil {
		canvasOnline[key] = map[string]canvasPresence{}
	}
	ids := []string{}
	for _, v := range strings.Split(selected, ",") {
		if v = strings.TrimSpace(v); v != "" {
			ids = append(ids, v)
		}
	}
	canvasOnline[key][user.ID] = canvasPresence{now, ids}
	online := []map[string]any{}
	members := map[string]bool{p.UserID: true}
	if p.TeamID != nil {
		list, err := repository.TeamMembers(*p.TeamID)
		if err != nil {
			return nil, err
		}
		members = map[string]bool{}
		for _, m := range list {
			if _, err := collaborationPermissions(m.UserID, "", &p, ""); err == nil {
				members[m.UserID] = true
			} else {
				var ce *CollabError
				if !errors.As(err, &ce) || ce.Status != 404 {
					return nil, err
				}
			}
		}
	}
	people := []string{}
	for userID, presence := range canvasOnline[key] {
		if now.Sub(presence.At) >= 10*time.Second || !members[userID] {
			delete(canvasOnline[key], userID)
		} else {
			people = append(people, userID)
		}
	}
	sort.Strings(people)
	for _, userID := range people {
		u, found, err := repository.GetUserByID(userID)
		if err != nil {
			return nil, err
		}
		if found {
			online = append(online, map[string]any{"user_id": userID, "name": displayName(u), "avatar": u.AvatarURL, "selected_ids": canvasOnline[key][userID].Selected})
		}
	}
	records, err := repository.CanvasChanges(p)
	if err != nil {
		return nil, err
	}
	if len(records) > 0 && since < records[0].Revision-1 && records[0].Revision > 2 {
		return map[string]any{"reset": true, "revision": p.Revision, "project_data": canvasPayload(p), "online": online, "can_edit": p.CanEdit, "can_manage_access": p.CanManageAccess}, nil
	}
	changes := []map[string]any{}
	for _, record := range records {
		if record.Revision > since {
			changes = append(changes, map[string]any{"revision": record.Revision, "user_id": record.UserID, "patch": json.RawMessage(record.Patch), "created_at": record.CreatedAt})
		}
	}
	return map[string]any{"revision": p.Revision, "changes": changes, "online": online, "can_edit": p.CanEdit, "can_manage_access": p.CanManageAccess}, nil
}

func CanReadFileForTeam(user model.AuthUser, fileID string) bool {
	if user.ID == "" || user.Role == model.UserRoleGuest || fileID == "" {
		return false
	}
	collabMu.Lock()
	defer collabMu.Unlock()
	object, err := repository.GetStorageObject(fileID)
	if err != nil {
		return false
	}
	projects, err := visibleCanvasProjects(user.ID)
	if err != nil {
		return false
	}
	for _, p := range projects {
		if p.TeamID == nil {
			continue
		}
		var data any
		if json.Unmarshal([]byte(p.ProjectData), &data) == nil {
			if teamFileReferenced(data, object) {
				return true
			}
		}
	}
	teams, err := repository.UserTeams(user.ID)
	if err != nil {
		return false
	}
	for _, team := range teams {
		if _, err := collaborationPermissions(user.ID, team.ID, nil, ""); err != nil {
			return false
		}
		assets, err := repository.TeamAssets(team.ID, "", "")
		if err != nil {
			return false
		}
		for _, asset := range assets {
			if teamFileReferenced(asset.FileURL, object) {
				return true
			}
		}
	}
	return false
}

func teamFileReferenced(value any, object model.StorageObject) bool {
	ids := map[string]bool{}
	showcaseFileIDs(value, ids)
	if ids[object.ID] {
		return true
	}
	// Cloud uploads can return their public URL instead of an /api/files URL.
	return object.PublicURL != "" && teamHasFileURL(value, object.PublicURL)
}
func teamHasFileURL(value any, fileURL string) bool {
	switch v := value.(type) {
	case string:
		return strings.Contains(v, fileURL)
	case []any:
		for _, item := range v {
			if teamHasFileURL(item, fileURL) {
				return true
			}
		}
	case map[string]any:
		for _, item := range v {
			if teamHasFileURL(item, fileURL) {
				return true
			}
		}
	}
	return false
}
