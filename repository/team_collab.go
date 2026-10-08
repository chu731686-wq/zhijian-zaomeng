package repository

import (
	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"time"
)

func CreateTeam(team model.Team, member model.TeamMember) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&team).Error; err != nil {
			return err
		}
		return tx.Create(&member).Error
	})
}
func UserTeams(userID string) ([]model.Team, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	teams := []model.Team{}
	err = db.Model(&model.Team{}).Where("deleted_at IS NULL AND id IN (?)", db.Model(&model.TeamMember{}).Select("team_id").Where("user_id = ?", userID)).Order("created_at ASC").Find(&teams).Error
	return teams, err
}
func FindTeam(id string) (model.Team, error) {
	db, err := DB()
	var team model.Team
	if err != nil {
		return team, err
	}
	err = db.Where("id = ? AND deleted_at IS NULL", id).First(&team).Error
	return team, err
}
func FindTeamMember(teamID, userID string) (model.TeamMember, error) {
	db, err := DB()
	var member model.TeamMember
	if err != nil {
		return member, err
	}
	err = db.Where("team_id = ? AND user_id = ?", teamID, userID).First(&member).Error
	return member, err
}
func TeamMembers(teamID string) ([]model.TeamMember, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	members := []model.TeamMember{}
	err = db.Where("team_id = ?", teamID).Order("joined_at ASC").Find(&members).Error
	return members, err
}
func RenameTeam(id, name string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.Team{}).Where("id = ?", id).Update("name", name).Error
}
func DissolveTeam(team model.Team, now time.Time) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var projects []model.CanvasProject
		if err := tx.Where("team_id = ?", team.ID).Find(&projects).Error; err != nil {
			return err
		}
		for _, project := range projects {
			if err := tx.Model(&model.CanvasChange{}).Where("project_id = ? AND project_user_id = ?", project.ID, project.UserID).Update("project_user_id", team.OwnerID).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&model.CanvasProject{}).Where("team_id = ?", team.ID).Updates(map[string]any{"team_id": nil, "user_id": team.OwnerID, "access_mode": "team", "access_members": ""}).Error; err != nil {
			return err
		}
		if err := tx.Where("team_id = ?", team.ID).Delete(&model.TeamAsset{}).Error; err != nil {
			return err
		}
		if err := tx.Where("team_id = ?", team.ID).Delete(&model.TeamMember{}).Error; err != nil {
			return err
		}
		return tx.Model(&model.Team{}).Where("id = ?", team.ID).Update("deleted_at", now).Error
	})
}
func AddTeamMember(member model.TeamMember) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Create(&member).Error
}
func RemoveTeamMember(teamID, userID string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Where("team_id = ? AND user_id = ?", teamID, userID).Delete(&model.TeamMember{}).Error
}
func CreateTeamInvite(invite model.TeamInvite) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Create(&invite).Error
}
func FindTeamInvite(token string) (model.TeamInvite, error) {
	db, err := DB()
	var invite model.TeamInvite
	if err != nil {
		return invite, err
	}
	err = db.Where("token = ?", token).First(&invite).Error
	return invite, err
}
func RevokeTeamInvite(teamID, token string, now time.Time) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.TeamInvite{}).Where("team_id = ? AND token = ?", teamID, token).Update("revoked_at", now).Error
}
func TeamAssets(teamID, kind, category string) ([]model.TeamAsset, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	q := db.Where("team_id = ?", teamID)
	if kind != "" {
		q = q.Where("kind = ?", kind)
	}
	if category != "" {
		q = q.Where("category = ?", category)
	}
	assets := []model.TeamAsset{}
	err = q.Order("created_at DESC").Find(&assets).Error
	return assets, err
}
func FindTeamAsset(teamID, id string) (model.TeamAsset, error) {
	db, err := DB()
	var asset model.TeamAsset
	if err != nil {
		return asset, err
	}
	err = db.Where("team_id = ? AND id = ?", teamID, id).First(&asset).Error
	return asset, err
}
func CreateTeamAsset(asset model.TeamAsset) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Create(&asset).Error
}
func UpdateTeamAsset(asset model.TeamAsset) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.TeamAsset{}).Where("team_id = ? AND id = ?", asset.TeamID, asset.ID).Updates(map[string]any{"name": asset.Name, "category": asset.Category}).Error
}
func DeleteTeamAsset(teamID, id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Where("team_id = ? AND id = ?", teamID, id).Delete(&model.TeamAsset{}).Error
}

// VisibleCanvasProjects uses membership rather than creator ownership for team projects.
func VisibleCanvasProjects(userID string) ([]model.CanvasProject, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	projects := []model.CanvasProject{}
	err = db.Table("canvas_projects AS p").Select("p.*, t.name AS team_name").Joins("LEFT JOIN teams AS t ON t.id = p.team_id AND t.deleted_at IS NULL").Where("p.deleted_at = '' AND ((p.team_id IS NULL AND p.user_id = ?) OR (t.id IS NOT NULL AND p.team_id IN (?)))", userID, db.Model(&model.TeamMember{}).Select("team_id").Where("user_id = ?", userID)).Order("p.updated_at DESC").Scan(&projects).Error
	return projects, err
}
func FindCanvasProjects(id string) ([]model.CanvasProject, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	projects := []model.CanvasProject{}
	err = db.Where("id = ?", id).Find(&projects).Error
	return projects, err
}
func MoveCanvasToTeam(project model.CanvasProject, teamID string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.CanvasProject{}).Where("user_id = ? AND id = ?", project.UserID, project.ID).Update("team_id", teamID).Error
}
func DeleteCanvasProject(project model.CanvasProject, now string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.CanvasProject{}).Where("user_id = ? AND id = ?", project.UserID, project.ID).Updates(map[string]any{"deleted_at": now, "updated_at": now, "project_data": ""}).Error
}
func SaveCanvasPatch(project model.CanvasProject, change model.CanvasChange) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.CanvasProject{}).Where("user_id = ? AND id = ?", project.UserID, project.ID).Updates(map[string]any{"project_data": project.ProjectData, "revision": project.Revision, "tombstones": project.Tombstones, "updated_at": project.UpdatedAt}).Error; err != nil {
			return err
		}
		if err := tx.Create(&change).Error; err != nil {
			return err
		}
		return tx.Where("project_id = ? AND project_user_id = ? AND revision <= ?", project.ID, project.UserID, project.Revision-500).Delete(&model.CanvasChange{}).Error
	})
}
func CanvasChanges(project model.CanvasProject) ([]model.CanvasChange, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	changes := []model.CanvasChange{}
	err = db.Where("project_id = ? AND project_user_id = ?", project.ID, project.UserID).Order("revision ASC").Find(&changes).Error
	return changes, err
}
func SaveCanvasTombstones(project model.CanvasProject, tombstones string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.CanvasProject{}).Where("user_id = ? AND id = ?", project.UserID, project.ID).Update("tombstones", tombstones).Error
}

func UpdateTeamMember(teamID, userID string, updates map[string]any) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.TeamMember{}).Where("team_id = ? AND user_id = ?", teamID, userID).Updates(updates).Error
}
func TransferTeam(team model.Team, userID string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.TeamMember{}).Where("team_id = ? AND user_id = ?", team.ID, team.OwnerID).Update("role", "admin").Error; err != nil {
			return err
		}
		if err := tx.Model(&model.TeamMember{}).Where("team_id = ? AND user_id = ?", team.ID, userID).Update("role", "owner").Error; err != nil {
			return err
		}
		return tx.Model(&model.Team{}).Where("id = ?", team.ID).Update("owner_id", userID).Error
	})
}
func SaveCanvasAccess(project model.CanvasProject, access model.CanvasAccess, members string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.CanvasProject{}).Where("user_id = ? AND id = ?", project.UserID, project.ID).Updates(map[string]any{"access_mode": access.Mode, "access_members": members}).Error
}
