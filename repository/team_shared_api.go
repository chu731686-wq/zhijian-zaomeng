package repository

import (
	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

func TeamSharedChannels(teamID string) ([]model.TeamSharedChannel, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	channels := []model.TeamSharedChannel{}
	err = db.Where("team_id = ?", teamID).Order("channel_id").Find(&channels).Error
	return channels, err
}
func SaveTeamSharedChannels(teamID string, ids []string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("team_id = ?", teamID).Delete(&model.TeamSharedChannel{}).Error; err != nil {
			return err
		}
		for _, id := range ids {
			if err := tx.Create(&model.TeamSharedChannel{TeamID: teamID, ChannelID: id}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
func RecordTeamAPIUsage(usage model.TeamAPIUsage) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Create(&usage).Error
}
func TeamAPIUsages(teamID string) ([]model.TeamAPIUsage, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	usages := []model.TeamAPIUsage{}
	err = db.Table("team_api_usage AS u").Select("u.*, COALESCE(NULLIF(p.display_name, ''), p.username, '') AS member_name").Joins("LEFT JOIN users AS p ON p.id = u.user_id").Where("u.team_id = ?", teamID).Order("u.id DESC").Limit(100).Scan(&usages).Error
	return usages, err
}
