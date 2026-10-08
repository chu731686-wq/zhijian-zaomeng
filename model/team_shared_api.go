package model

import "time"

type TeamSharedChannel struct {
	TeamID    string `gorm:"primaryKey"`
	ChannelID string `gorm:"primaryKey"`
}

type TeamAPIUsage struct {
	ID         uint64    `json:"id" gorm:"primaryKey;autoIncrement"`
	TeamID     string    `json:"team_id" gorm:"index"`
	UserID     string    `json:"user_id"`
	ChannelID  string    `json:"channel_id"`
	Model      string    `json:"model"`
	Path       string    `json:"path"`
	Status     int       `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
	MemberName string    `json:"member_name" gorm:"->;-:migration"`
}

func (TeamAPIUsage) TableName() string { return "team_api_usage" }
