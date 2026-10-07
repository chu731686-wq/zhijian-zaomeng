package model

import "time"

type ComfyBridge struct {
	ID               string     `json:"id" gorm:"primaryKey;size:64"`
	OwnerScope       string     `json:"ownerScope" gorm:"index:idx_comfy_bridges_owner,priority:1;size:16"`
	OwnerID          string     `json:"ownerId" gorm:"index:idx_comfy_bridges_owner,priority:2;size:64"`
	Name             string     `json:"name" gorm:"size:80"`
	TokenHash        string     `json:"-" gorm:"uniqueIndex;size:64"`
	Enabled          bool       `json:"enabled"`
	LastSeenAt       *time.Time `json:"lastSeenAt,omitempty"`
	CapabilitiesJSON string     `json:"-" gorm:"size:134217728"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

type ComfyBridgeRequest struct {
	ID             string     `json:"id" gorm:"primaryKey;size:64"`
	BridgeID       string     `json:"bridgeId" gorm:"index:idx_comfy_bridge_queue,priority:1;size:64"`
	OwnerScope     string     `json:"ownerScope" gorm:"size:16"`
	OwnerID        string     `json:"ownerId" gorm:"size:64"`
	TaskID         string     `json:"taskId" gorm:"index;size:64"`
	Kind           string     `json:"kind" gorm:"size:32"`
	Status         string     `json:"status" gorm:"index:idx_comfy_bridge_queue,priority:2;size:24"`
	PayloadJSON    string     `json:"-" gorm:"size:134217728"`
	ResultJSON     string     `json:"-" gorm:"size:134217728"`
	Error          string     `json:"error,omitempty" gorm:"type:text"`
	ClaimedAt      *time.Time `json:"claimedAt,omitempty"`
	LeaseToken     string     `json:"-" gorm:"size:64"`
	LeaseExpiresAt *time.Time `json:"leaseExpiresAt,omitempty" gorm:"index"`
	CheckpointJSON string     `json:"-" gorm:"type:text"`
	CompletedAt    *time.Time `json:"completedAt,omitempty"`
	CleanupReadyAt *time.Time `json:"cleanupReadyAt,omitempty" gorm:"index"`
	ExpiresAt      time.Time  `json:"expiresAt" gorm:"index"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}
