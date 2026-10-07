package repository

import (
	"errors"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrEmailCooldown = errors.New("同一邮箱 60 秒内不能重发验证码")
	ErrAuthRateLimit = errors.New("请求太频繁，请稍后再试")
	ErrEmailCode     = errors.New("验证码无效、已使用或已过期，请重新获取")
	ErrInvite        = errors.New("邀请码无效、已使用或已作废")
	ErrEmailTaken    = errors.New("邮箱已注册，请使用邮箱登录或忘记密码")
)

func GetUserByLogin(value string) (model.User, bool, error) {
	user, found, err := GetUserByUsername(value)
	if err != nil || found {
		return user, found, err
	}
	if strings.Contains(value, "@") {
		return GetUserByEmail(value)
	}
	return model.User{}, false, nil
}

func GetUserByEmail(email string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	// 旧库允许重复邮箱；遇到歧义拒绝登录/重设，避免选错账号。
	var users []model.User
	err = db.Where("LOWER(email) = ?", strings.ToLower(strings.TrimSpace(email))).Limit(2).Find(&users).Error
	if err != nil || len(users) != 1 {
		return model.User{}, false, err
	}
	return users[0], true, nil
}

func GetUserByGoogleID(id string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	return findUser(db, "google_id = ?", id)
}

func GetUserByGithubID(id string) (model.User, bool, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, false, err
	}
	return findUser(db, "github_id = ?", id)
}

// TakeAuthRate 原子计数，进程重启不会清空限额。
func TakeAuthRate(key string, timestamp, window int64, limit int) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("expires_at <= ?", timestamp).Delete(&model.AuthRateLimit{}).Error; err != nil {
			return err
		}
		row := model.AuthRateLimit{Key: key, Count: 0, ExpiresAt: timestamp + window}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
			return err
		}
		result := tx.Model(&model.AuthRateLimit{}).Where("key = ? AND count < ?", key, limit).Update("count", gorm.Expr("count + 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrAuthRateLimit
		}
		return nil
	})
}

func SaveEmailCode(code model.EmailCode) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&code)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 {
			return nil
		}
		result = tx.Model(&model.EmailCode{}).Where("email = ? AND sent_at <= ?", code.Email, code.SentAt-60).Updates(map[string]any{
			"purpose": code.Purpose, "hash": code.Hash, "sent_at": code.SentAt, "expires_at": code.ExpiresAt, "attempts": 0, "used": false,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrEmailCooldown
		}
		return nil
	})
}

func GetEmailCode(email string) (model.EmailCode, error) {
	db, err := DB()
	if err != nil {
		return model.EmailCode{}, err
	}
	var code model.EmailCode
	err = db.Where("email = ?", email).First(&code).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return code, ErrEmailCode
	}
	return code, err
}

func FailEmailCode(code model.EmailCode, timestamp int64) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.EmailCode{}).Where("email = ? AND hash = ? AND attempts < 5 AND used = ? AND expires_at > ?", code.Email, code.Hash, false, timestamp).Update("attempts", gorm.Expr("attempts + 1")).Error
}

func InvalidateEmailCode(code model.EmailCode) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Model(&model.EmailCode{}).Where("email = ? AND hash = ?", code.Email, code.Hash).Update("used", true).Error
}

func consumeEmailCode(tx *gorm.DB, code model.EmailCode, timestamp int64) error {
	result := tx.Model(&model.EmailCode{}).Where("email = ? AND hash = ? AND purpose = ? AND expires_at > ? AND attempts < 5 AND used = ?", code.Email, code.Hash, code.Purpose, timestamp, false).Update("used", true)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrEmailCode
	}
	return nil
}

// RegisterVerifiedUser 验证码、邀请码和账号在同一事务内提交。
func RegisterVerifiedUser(user model.User, invite string, code *model.EmailCode, timestamp int64) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if code != nil {
			if err := consumeEmailCode(tx, *code, timestamp); err != nil {
				return err
			}
		}
		if invite != "" {
			result := tx.Model(&model.RegistrationInvite{}).Where("code = ? AND used_by = ? AND revoked = ?", invite, "", false).Updates(map[string]any{"used_by": user.ID, "used_at": user.CreatedAt})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrInvite
			}
		}
		var count int64
		if err := tx.Model(&model.User{}).Where("LOWER(email) = ?", user.Email).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrEmailTaken
		}
		return tx.Create(&user).Error
	})
}

func ResetVerifiedPassword(userID, password, updatedAt string, code model.EmailCode, timestamp int64) (model.User, error) {
	db, err := DB()
	if err != nil {
		return model.User{}, err
	}
	var user model.User
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := consumeEmailCode(tx, code, timestamp); err != nil {
			return err
		}
		result := tx.Model(&model.User{}).Where("id = ? AND LOWER(email) = ? AND status = ?", userID, code.Email, model.UserStatusActive).Updates(map[string]any{"password": password, "updated_at": updatedAt, "last_login_at": updatedAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrEmailCode
		}
		return tx.First(&user, "id = ?", userID).Error
	})
	return user, err
}

func ListRegistrationInvites() ([]model.RegistrationInvite, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	items := []model.RegistrationInvite{}
	err = db.Order("created_at DESC").Find(&items).Error
	return items, err
}

func CreateRegistrationInvite(invite model.RegistrationInvite) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Create(&invite).Error
}

func RevokeRegistrationInvite(code string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	result := db.Model(&model.RegistrationInvite{}).Where("code = ? AND used_by = ? AND revoked = ?", code, "", false).Update("revoked", true)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrInvite
	}
	return nil
}
