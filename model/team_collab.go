package model

import "time"

type Team struct {
	ID          string     `json:"id" gorm:"primaryKey"`
	Name        string     `json:"name"`
	OwnerID     string     `json:"owner_id" gorm:"index"`
	CreatedAt   time.Time  `json:"created_at"`
	DeletedAt   *time.Time `json:"-" gorm:"index"`
	Role        string     `json:"role,omitempty" gorm:"-"`
	MemberCount int64      `json:"member_count" gorm:"-"`
}

type TeamMember struct {
	TeamID        string    `json:"team_id" gorm:"primaryKey"`
	UserID        string    `json:"user_id" gorm:"primaryKey"`
	Role          string    `json:"role" gorm:"not null;default:editor"`
	CanUseTeamAPI bool      `json:"can_use_team_api" gorm:"not null;default:false"`
	JoinedAt      time.Time `json:"joined_at"`
}

type TeamInvite struct {
	Token     string     `json:"token" gorm:"primaryKey;size:128"`
	TeamID    string     `json:"team_id" gorm:"index"`
	CreatedBy string     `json:"created_by"`
	Role      string     `json:"role" gorm:"not null;default:editor"`
	ExpiresAt time.Time  `json:"expires_at"`
	RevokedAt *time.Time `json:"revoked_at"`
}

type TeamAsset struct {
	ID          string    `json:"id" gorm:"primaryKey"`
	TeamID      string    `json:"team_id" gorm:"index"`
	CreatedBy   string    `json:"created_by"`
	Kind        string    `json:"kind"`
	Name        string    `json:"name"`
	Category    string    `json:"category"`
	FileURL     string    `json:"file_url,omitempty"`
	TextContent string    `json:"text_content,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

type CanvasChange struct {
	UserID        string    `json:"user_id"`
	ProjectID     string    `json:"-" gorm:"primaryKey"`
	ProjectUserID string    `json:"-" gorm:"primaryKey"`
	Revision      int64     `json:"revision" gorm:"primaryKey"`
	Patch         string    `json:"-"`
	CreatedAt     time.Time `json:"created_at"`
}

// CanvasAccess is persisted separately from the collaborative document.
type CanvasAccessMember struct {
	UserID     string `json:"user_id"`
	Permission string `json:"permission"`
}
type CanvasAccess struct {
	Mode    string               `json:"mode"`
	Members []CanvasAccessMember `json:"members"`
}
