package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"gorm.io/gorm"
)

type collabPermissions struct {
	Team                                                                         model.Team
	Member                                                                       model.TeamMember
	CanRead, CanEdit, CanDelete, CanManageAccess, CanLeave                       bool
	CanRename, CanInvite, CanDissolve, CanTransfer, CanSetTeamAPI, CanUseTeamAPI bool
	ManagedRoles                                                                 map[string]bool
}

// Call under collabMu. This is the single policy for teams, canvases and assets;
// creatorID supplies asset ownership when project is nil. Membership always wins
// over a saved custom access list, so leaving a team revokes access immediately.
func collaborationPermissions(userID, teamID string, project *model.CanvasProject, creatorID string) (collabPermissions, error) {
	p := collabPermissions{ManagedRoles: map[string]bool{}}
	if project != nil {
		creatorID = project.UserID
		if project.DeletedAt != "" {
			return p, collabError(404, "画布项目不存在")
		}
		if project.TeamID == nil {
			p.CanRead = creatorID == userID
			p.CanEdit, p.CanDelete, p.CanManageAccess = p.CanRead, p.CanRead, p.CanRead
			if !p.CanRead {
				return p, collabError(404, "画布项目不存在")
			}
			return p, nil
		}
		teamID = *project.TeamID
	}
	var err error
	p.Team, err = repository.FindTeam(teamID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return p, collabError(404, "团队不存在")
	}
	if err != nil {
		return p, err
	}
	p.Member, err = repository.FindTeamMember(teamID, userID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return p, collabError(404, "团队不存在")
	}
	if err != nil {
		return p, err
	}
	owner := p.Member.Role == "owner"
	manager := owner || p.Member.Role == "admin"
	p.CanRead = true
	p.CanEdit = manager || p.Member.Role == "editor"
	p.CanDelete = manager || p.CanEdit && creatorID == userID
	p.CanManageAccess = p.CanDelete
	p.CanRename, p.CanInvite = manager, manager
	p.CanDissolve, p.CanTransfer, p.CanSetTeamAPI = owner, owner, owner
	p.CanLeave = !owner
	if manager {
		p.ManagedRoles["editor"], p.ManagedRoles["viewer"] = true, true
	}
	if owner {
		p.ManagedRoles["admin"] = true
	}
	if project != nil && project.AccessMode == "custom" && !manager && creatorID != userID {
		access, err := canvasAccessConfig(*project)
		if err != nil {
			return p, err
		}
		p.CanRead, p.CanEdit = false, false
		for _, member := range access.Members {
			if member.UserID == userID {
				p.CanRead = true
				p.CanEdit = member.Permission == "edit" && p.Member.Role == "editor"
				break
			}
		}
	}
	p.CanUseTeamAPI = (owner || p.Member.CanUseTeamAPI) && p.CanEdit
	if !p.CanRead {
		return p, collabError(404, "画布项目不存在")
	}
	return p, nil
}

func requireCollabPermission(allowed bool) error {
	if !allowed {
		return collabError(403, "无权进行此操作")
	}
	return nil
}

func canvasAccessConfig(project model.CanvasProject) (model.CanvasAccess, error) {
	access := model.CanvasAccess{Mode: project.AccessMode, Members: []model.CanvasAccessMember{}}
	if access.Mode == "" {
		access.Mode = "team"
	}
	if project.AccessMembers != "" {
		if err := json.Unmarshal([]byte(project.AccessMembers), &access.Members); err != nil {
			return access, err
		}
	}
	return access, nil
}

func UpdateCurrentTeamMember(ctx context.Context, id, target string, role *string, canUseTeamAPI *bool) error {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return err
	}
	permissions, err := collaborationPermissions(user.ID, id, nil, "")
	if err != nil {
		return err
	}
	member, err := repository.FindTeamMember(id, target)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return collabError(404, "成员不存在")
	}
	if err != nil {
		return err
	}
	if !permissions.ManagedRoles[member.Role] {
		return collabError(403, "无权修改该成员")
	}
	updates := map[string]any{}
	if role != nil {
		if *role != "admin" && *role != "editor" && *role != "viewer" {
			return collabError(400, "成员身份无效")
		}
		if err := requireCollabPermission(permissions.ManagedRoles[*role]); err != nil {
			return err
		}
		updates["role"] = *role
	}
	if canUseTeamAPI != nil {
		if err := requireCollabPermission(permissions.CanSetTeamAPI); err != nil {
			return err
		}
		updates["can_use_team_api"] = *canUseTeamAPI
	}
	if len(updates) == 0 {
		return collabError(400, "请指定身份或团队接口权限")
	}
	return repository.UpdateTeamMember(id, target, updates)
}

func TransferCurrentTeam(ctx context.Context, id, target string) error {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return err
	}
	permissions, err := collaborationPermissions(user.ID, id, nil, "")
	if err != nil {
		return err
	}
	if err := requireCollabPermission(permissions.CanTransfer); err != nil {
		return err
	}
	if target == user.ID {
		return collabError(400, "请选择其他团队成员")
	}
	if _, err = repository.FindTeamMember(id, target); errors.Is(err, gorm.ErrRecordNotFound) {
		return collabError(404, "成员不存在")
	}
	if err != nil {
		return err
	}
	return repository.TransferTeam(permissions.Team, target)
}

func CurrentCanvasAccess(ctx context.Context, id string, input *model.CanvasAccess) (model.CanvasAccess, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return model.CanvasAccess{}, err
	}
	project, err := canvasAccess(user.ID, id)
	if err != nil {
		return model.CanvasAccess{}, err
	}
	if input == nil {
		return canvasAccessConfig(project)
	}
	if err := requireCollabPermission(project.CanManageAccess); err != nil {
		return model.CanvasAccess{}, err
	}
	if project.TeamID == nil {
		return model.CanvasAccess{}, collabError(400, "只有团队画布可设单独权限")
	}
	if input.Mode != "team" && input.Mode != "custom" {
		return model.CanvasAccess{}, collabError(400, "画布权限模式无效")
	}
	if input.Members == nil {
		input.Members = []model.CanvasAccessMember{}
	}
	seen := map[string]bool{}
	for _, member := range input.Members {
		if member.UserID == "" || seen[member.UserID] || member.Permission != "edit" && member.Permission != "view" {
			return model.CanvasAccess{}, collabError(400, "画布成员权限无效")
		}
		seen[member.UserID] = true
		if _, err := repository.FindTeamMember(*project.TeamID, member.UserID); errors.Is(err, gorm.ErrRecordNotFound) {
			return model.CanvasAccess{}, collabError(400, "画布名单必须为团队成员")
		} else if err != nil {
			return model.CanvasAccess{}, err
		}
	}
	if input.Mode == "team" {
		input.Members = []model.CanvasAccessMember{}
	}
	raw, err := json.Marshal(input.Members)
	if err != nil {
		return model.CanvasAccess{}, err
	}
	return *input, repository.SaveCanvasAccess(project, *input, string(raw))
}

// Repository queries fetch candidates; all visibility decisions stay in the policy.
func visibleCanvasProjects(userID string) ([]model.CanvasProject, error) {
	projects, err := repository.VisibleCanvasProjects(userID)
	if err != nil {
		return nil, err
	}
	visible := []model.CanvasProject{}
	for _, project := range projects {
		permissions, err := collaborationPermissions(userID, "", &project, "")
		if err != nil {
			var ce *CollabError
			if errors.As(err, &ce) && ce.Status == 404 {
				continue
			}
			return nil, err
		}
		project.CanEdit, project.CanManageAccess = permissions.CanEdit, permissions.CanManageAccess
		visible = append(visible, project)
	}
	return visible, nil
}

// Unpersisted personal canvases keep the existing local-generation behavior.
// All requests naming a team canvas must pass the same current edit policy.
func AuthorizeCanvasGeneration(userID, source, projectID string) error {
	if source != "canvas" || projectID == "" {
		return nil
	}
	collabMu.Lock()
	defer collabMu.Unlock()
	projects, err := repository.FindCanvasProjects(projectID)
	if err != nil {
		return err
	}
	shared := false
	for _, project := range projects {
		if project.TeamID != nil {
			shared = true
		}
	}
	if !shared {
		return nil
	}
	project, err := canvasAccess(userID, projectID)
	if err != nil {
		return err
	}
	return requireCollabPermission(project.CanEdit)
}
