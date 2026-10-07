package repository

import (
	"errors"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func GetUserWebSearchSetting(userID string) (model.UserWebSearchSetting, error) {
	setting := model.UserWebSearchSetting{UserID: userID, Provider: "bocha"}
	db, err := DB()
	if err != nil {
		return setting, err
	}
	err = db.First(&setting, "user_id = ?", userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return setting, nil
	}
	if err != nil {
		return setting, err
	}
	if setting.APIKey != "" {
		setting.APIKey, err = decryptUserConfigSecret(setting.APIKey)
	}
	return setting, err
}

func SaveUserWebSearchSetting(setting model.UserWebSearchSetting) error {
	db, err := DB()
	if err != nil {
		return err
	}
	if setting.APIKey != "" {
		setting.APIKey, err = encryptUserConfigSecret(setting.APIKey)
		if err != nil {
			return err
		}
	}
	return db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}}, DoUpdates: clause.AssignmentColumns([]string{"provider", "api_key"})}).Create(&setting).Error
}
