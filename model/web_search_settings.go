package model

// UserWebSearchSetting stores each account's provider secret encrypted at rest.
type UserWebSearchSetting struct {
	UserID   string `json:"-" gorm:"primaryKey"`
	Provider string `json:"provider"`
	APIKey   string `json:"-" gorm:"type:text"`
}
