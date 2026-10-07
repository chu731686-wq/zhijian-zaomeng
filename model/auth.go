package model

// EmailCode 每个规范化邮箱只保留一条验证码；发送新码会替换旧码。
type EmailCode struct {
	Email     string `gorm:"primaryKey;size:254"`
	Purpose   string `gorm:"size:16"`
	Hash      string `gorm:"size:64"`
	SentAt    int64
	ExpiresAt int64
	Attempts  int
	Used      bool
}

type RegistrationInvite struct {
	Code      string `json:"code" gorm:"primaryKey;size:64"`
	CreatedAt string `json:"createdAt"`
	CreatedBy string `json:"createdBy"`
	UsedBy    string `json:"usedBy"`
	UsedAt    string `json:"usedAt"`
	Revoked   bool   `json:"revoked"`
}

type AuthRateLimit struct {
	Key       string `gorm:"primaryKey;size:64"`
	Count     int
	ExpiresAt int64 `gorm:"index"`
}
