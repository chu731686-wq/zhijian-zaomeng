package repository

import (
	"errors"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func userConfigTimestamp() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func GetUserConfig(userID string) (model.UserConfig, bool, error) {
	db, err := DB()
	if err != nil {
		return model.UserConfig{}, false, err
	}

	var config model.UserConfig
	err = db.First(&config, "user_id = ?", userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.UserConfig{}, false, nil
	}
	if err != nil {
		return model.UserConfig{}, false, err
	}
	config.ModelConfig, err = decryptUserModelConfig(config.ModelConfig)
	if err != nil {
		return model.UserConfig{}, false, err
	}
	return config, true, nil
}

func SaveUserConfig(config model.UserConfig) (model.UserConfig, error) {
	db, err := DB()
	if err != nil {
		return config, err
	}

	config.UpdatedAt = userConfigTimestamp()
	persisted := config
	persisted.ModelConfig, err = encryptUserModelConfig(config.ModelConfig)
	if err != nil {
		return config, err
	}
	return config, db.Save(&persisted).Error
}

// SaveUserConfigFields prevents unrelated concurrent sync requests from overwriting each other.
func SaveUserConfigFields(config model.UserConfig, fields ...string) (model.UserConfig, error) {
	db, err := DB()
	if err != nil {
		return config, err
	}
	config.UpdatedAt = userConfigTimestamp()
	persisted := config
	persisted.ModelConfig, err = encryptUserModelConfig(config.ModelConfig)
	if err != nil {
		return config, err
	}
	fields = append(fields, "updated_at")
	err = db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}}, DoUpdates: clause.AssignmentColumns(fields)}).Create(&persisted).Error
	return config, err
}
