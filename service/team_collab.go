package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"gorm.io/gorm"
)

// One process-wide lock also serializes membership changes with canvas authorization.
// Render runs a single instance. Patch data and its change record commit atomically.
var collabMu sync.Mutex

type CollabError struct {
	Status  int
	Message string
}

func (e *CollabError) Error() string               { return e.Message }
func collabError(status int, message string) error { return &CollabError{status, message} }
func collabUser(ctx context.Context) (model.AuthUser, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" || user.Role == model.UserRoleGuest {
		return user, collabError(401, "请先登录")
	}
	return user, nil
}
func teamAccess(userID, teamID string, ownerOnly bool) (model.Team, model.TeamMember, error) {
	permissions, err := collaborationPermissions(userID, teamID, nil, "")
	if err == nil && ownerOnly {
		err = requireCollabPermission(permissions.CanDissolve)
	}
	return permissions.Team, permissions.Member, err
}
func teamName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if n := utf8.RuneCountInString(name); n < 1 || n > 40 {
		return "", collabError(400, "团队名须为1～40字")
	}
	return name, nil
}
func CreateCurrentTeam(ctx context.Context, name string) (model.Team, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return model.Team{}, err
	}
	name, err = teamName(name)
	if err != nil {
		return model.Team{}, err
	}
	now := time.Now().UTC()
	team := model.Team{ID: uuid.NewString(), Name: name, OwnerID: user.ID, CreatedAt: now, Role: "owner", MemberCount: 1}
	err = repository.CreateTeam(team, model.TeamMember{TeamID: team.ID, UserID: user.ID, Role: "owner", JoinedAt: now})
	return team, err
}
func CurrentTeams(ctx context.Context) ([]model.Team, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return nil, err
	}
	teams, err := repository.UserTeams(user.ID)
	if err != nil {
		return nil, err
	}
	for i := range teams {
		permissions, err := collaborationPermissions(user.ID, teams[i].ID, nil, "")
		if err != nil {
			return nil, err
		}
		teams[i].Role = permissions.Member.Role
		members, err := repository.TeamMembers(teams[i].ID)
		if err != nil {
			return nil, err
		}
		teams[i].MemberCount = int64(len(members))
	}
	return teams, nil
}
func displayName(user model.User) string {
	if user.DisplayName != "" {
		return user.DisplayName
	}
	return user.Username
}
func CurrentTeam(ctx context.Context, id string) (any, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return nil, err
	}
	team, member, err := teamAccess(user.ID, id, false)
	if err != nil {
		return nil, err
	}
	team.Role = member.Role
	members, err := repository.TeamMembers(id)
	if err != nil {
		return nil, err
	}
	team.MemberCount = int64(len(members))
	people := []map[string]any{}
	for _, m := range members {
		u, found, err := repository.GetUserByID(m.UserID)
		if err != nil {
			return nil, err
		}
		if found {
			people = append(people, map[string]any{"id": u.ID, "user_id": u.ID, "name": displayName(u), "avatar": u.AvatarURL, "role": m.Role, "can_use_team_api": m.CanUseTeamAPI})
		}
	}
	return struct {
		model.Team
		Members []map[string]any `json:"members"`
	}{team, people}, nil
}
func RenameCurrentTeam(ctx context.Context, id, name string) error {
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
	if err := requireCollabPermission(permissions.CanRename); err != nil {
		return err
	}
	name, err = teamName(name)
	if err != nil {
		return err
	}
	return repository.RenameTeam(id, name)
}
func DissolveCurrentTeam(ctx context.Context, id string) error {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return err
	}
	team, _, err := teamAccess(user.ID, id, true)
	if err != nil {
		return err
	}
	return repository.DissolveTeam(team, time.Now().UTC())
}
func DeleteCurrentTeamMember(ctx context.Context, id, target string) error {
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
	if target != user.ID && len(permissions.ManagedRoles) == 0 {
		return collabError(403, "无权移除其他成员")
	}
	member, err := repository.FindTeamMember(id, target)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := requireCollabPermission(target == user.ID && permissions.CanLeave || permissions.ManagedRoles[member.Role]); err != nil {
		return err
	}
	return repository.RemoveTeamMember(id, target)
}
func CreateCurrentTeamInvite(ctx context.Context, id string, roles ...string) (model.TeamInvite, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return model.TeamInvite{}, err
	}
	permissions, err := collaborationPermissions(user.ID, id, nil, "")
	if err != nil {
		return model.TeamInvite{}, err
	}
	if err := requireCollabPermission(permissions.CanInvite); err != nil {
		return model.TeamInvite{}, err
	}
	role := "editor"
	if len(roles) > 0 && roles[0] != "" {
		role = roles[0]
	}
	if role != "editor" && role != "viewer" {
		return model.TeamInvite{}, collabError(400, "邀请身份只能为editor或viewer")
	}
	random := make([]byte, 32)
	if _, err = rand.Read(random); err != nil {
		return model.TeamInvite{}, err
	}
	invite := model.TeamInvite{Token: base64.RawURLEncoding.EncodeToString(random), TeamID: id, CreatedBy: user.ID, Role: role, ExpiresAt: time.Now().UTC().Add(7 * 24 * time.Hour)}
	return invite, repository.CreateTeamInvite(invite)
}
func RevokeCurrentTeamInvite(ctx context.Context, id, token string) error {
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
	if err := requireCollabPermission(permissions.CanInvite); err != nil {
		return err
	}
	invite, err := repository.FindTeamInvite(token)
	if errors.Is(err, gorm.ErrRecordNotFound) || err == nil && invite.TeamID != id {
		return collabError(404, "邀请不存在")
	}
	if err != nil {
		return err
	}
	return repository.RevokeTeamInvite(id, token, time.Now().UTC())
}
func inviteTeam(token string) (model.TeamInvite, model.Team, error) {
	invite, err := repository.FindTeamInvite(token)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return invite, model.Team{}, collabError(404, "邀请不存在")
	}
	if err != nil {
		return invite, model.Team{}, err
	}
	team, err := repository.FindTeam(invite.TeamID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = collabError(410, "团队已解散")
	}
	return invite, team, err
}
func PreviewTeamInvite(ctx context.Context, token string) (any, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return nil, err
	}
	invite, team, err := inviteTeam(token)
	if err != nil {
		return nil, err
	}
	inviter, _, err := repository.GetUserByID(invite.CreatedBy)
	if err != nil {
		return nil, err
	}
	_, err = repository.FindTeamMember(team.ID, user.ID)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	return map[string]any{"team_name": team.Name, "inviter_name": displayName(inviter), "is_member": err == nil, "expired": !invite.ExpiresAt.After(time.Now()), "revoked": invite.RevokedAt != nil, "role": invite.Role}, nil
}
func AcceptTeamInvite(ctx context.Context, token string) (model.Team, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return model.Team{}, err
	}
	invite, team, err := inviteTeam(token)
	if err != nil {
		return team, err
	}
	_, err = repository.FindTeamMember(team.ID, user.ID)
	if err == nil {
		return team, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return team, err
	}
	if invite.RevokedAt != nil {
		return team, collabError(410, "邀请已撤销")
	}
	if !invite.ExpiresAt.After(time.Now()) {
		return team, collabError(410, "邀请已过期")
	}
	members, err := repository.TeamMembers(team.ID)
	if err != nil {
		return team, err
	}
	if len(members) >= 20 {
		return team, collabError(409, "团队已满20人")
	}
	return team, repository.AddTeamMember(model.TeamMember{TeamID: team.ID, UserID: user.ID, Role: invite.Role, JoinedAt: time.Now().UTC()})
}
func CurrentTeamAssets(ctx context.Context, id, kind, category string) ([]model.TeamAsset, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return nil, err
	}
	if _, _, err = teamAccess(user.ID, id, false); err != nil {
		return nil, err
	}
	return repository.TeamAssets(id, kind, category)
}
func validAssetCategory(category string) bool {
	switch category {
	case "人物", "场景", "道具", "分集", "其他":
		return true
	}
	return false
}
func CreateCurrentTeamAsset(ctx context.Context, id string, asset model.TeamAsset) (model.TeamAsset, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return asset, err
	}
	permissions, err := collaborationPermissions(user.ID, id, nil, "")
	if err != nil {
		return asset, err
	}
	if err := requireCollabPermission(permissions.CanEdit); err != nil {
		return asset, err
	}
	asset.Name = strings.TrimSpace(asset.Name)
	if asset.Name == "" || !validAssetCategory(asset.Category) {
		return asset, collabError(400, "素材名称或分类无效")
	}
	switch asset.Kind {
	case "text":
		if strings.TrimSpace(asset.TextContent) == "" {
			return asset, collabError(400, "文本内容不能为空")
		}
	case "image", "video", "audio":
		if strings.TrimSpace(asset.FileURL) == "" {
			return asset, collabError(400, "文件地址不能为空")
		}
	default:
		return asset, collabError(400, "素材类型无效")
	}
	asset.ID = uuid.NewString()
	asset.TeamID = id
	asset.CreatedBy = user.ID
	asset.CreatedAt = time.Now().UTC()
	return asset, repository.CreateTeamAsset(asset)
}
func EditCurrentTeamAsset(ctx context.Context, id, assetID string, name, category *string, remove bool) (model.TeamAsset, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, err := collabUser(ctx)
	if err != nil {
		return model.TeamAsset{}, err
	}
	_, _, err = teamAccess(user.ID, id, false)
	if err != nil {
		return model.TeamAsset{}, err
	}
	asset, err := repository.FindTeamAsset(id, assetID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return asset, collabError(404, "素材不存在")
	}
	if err != nil {
		return asset, err
	}
	permissions, err := collaborationPermissions(user.ID, id, nil, asset.CreatedBy)
	if err != nil {
		return asset, err
	}
	if err := requireCollabPermission(permissions.CanDelete); err != nil {
		return asset, err
	}
	if remove {
		return asset, repository.DeleteTeamAsset(id, assetID)
	}
	if name != nil {
		asset.Name = strings.TrimSpace(*name)
	}
	if category != nil {
		asset.Category = *category
	}
	if asset.Name == "" || !validAssetCategory(asset.Category) {
		return asset, collabError(400, "素材名称或分类无效")
	}
	return asset, repository.UpdateTeamAsset(asset)
}
