package model

type CanvasProject struct {
	AccessMode      string  `json:"-" gorm:"not null;default:team"`
	AccessMembers   string  `json:"-" gorm:"type:text"`
	CanEdit         bool    `json:"can_edit" gorm:"-"`
	CanManageAccess bool    `json:"can_manage_access" gorm:"-"`
	TeamID          *string `json:"team_id" gorm:"index"`
	TeamName        string  `json:"team_name" gorm:"->;-:migration"`
	Revision        int64   `json:"revision" gorm:"not null;default:1"`
	Tombstones      string  `json:"-" gorm:"type:text"`
	Published       bool    `json:"published" gorm:"not null;default:false;index"`
	UserID          string  `json:"userId" gorm:"primaryKey;index:idx_canvas_projects_user_deleted_updated,priority:1"`
	ID              string  `json:"id" gorm:"primaryKey"`
	ProjectData     string  `json:"projectData"`
	CreatedAt       string  `json:"createdAt"`
	UpdatedAt       string  `json:"updatedAt" gorm:"index:idx_canvas_projects_user_deleted_updated,priority:3"`
	DeletedAt       string  `json:"deletedAt" gorm:"not null;default:'';index:idx_canvas_projects_deleted_at;index:idx_canvas_projects_user_deleted_updated,priority:2"`
}
