package repository

import (
	"errors"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

// ListAssets 按查询条件返回素材分页列表。
func ListAssets(q model.Query) ([]model.Asset, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	q.Normalize()
	tx := applyAssetFilters(db.Model(&model.Asset{}), q)

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var items []model.Asset
	err = tx.Order("updated_at desc").Offset(q.Offset()).Limit(q.PageSize).Find(&items).Error
	return items, total, err
}

// ListAssetFilters 返回当前素材查询条件下的全部标签和分类。
func ListAssetFilters(q model.Query) ([]string, []string, error) {
	db, err := DB()
	if err != nil {
		return nil, nil, err
	}
	q.Normalize()
	q.Tags = nil
	q.Category = ""
	tx := applyAssetFilters(db.Model(&model.Asset{}), q)

	var items []model.Asset
	if err := tx.Select("tags", "category").Find(&items).Error; err != nil {
		return nil, nil, err
	}
	categories := []string{}
	seen := map[string]bool{}
	for _, item := range items {
		if item.Category != "" && !seen[item.Category] {
			seen[item.Category] = true
			categories = append(categories, item.Category)
		}
	}
	return assetTagsFromItems(items), categories, nil
}

// SaveAsset 保存素材，并在更新时保留原创建时间。
func SaveAsset(item model.Asset) (model.Asset, error) {
	db, err := DB()
	if err != nil {
		return item, err
	}
	if saved, ok, err := findAsset(db, item.ID); err != nil {
		return item, err
	} else if ok && item.CreatedAt == "" {
		item.CreatedAt = saved.CreatedAt
	}
	return item, db.Save(&item).Error
}

// DeleteAsset 删除指定素材。
func DeleteAsset(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.Asset{}, "id = ?", id).Error
}

// applyAssetFilters 应用素材列表的搜索条件。
func applyAssetFilters(tx *gorm.DB, q model.Query) *gorm.DB {
	if q.Keyword != "" {
		like := "%" + q.Keyword + "%"
		tagsColumn := "CAST(tags AS TEXT)"
		if tx.Dialector.Name() == "mysql" {
			tagsColumn = "CAST(tags AS CHAR)"
		}
		tx = tx.Where("title LIKE ? OR description LIKE ? OR content LIKE ? OR category LIKE ? OR "+tagsColumn+" LIKE ?", like, like, like, like, like)
	}
	if isActiveAssetOption(q.Type) {
		tx = tx.Where("type = ?", q.Type)
	}
	if isActiveAssetOption(q.Category) {
		tx = tx.Where("category = ?", q.Category)
	}
	return applyAssetTagsFilter(tx, q.Tags)
}

// findAsset 根据 ID 查询素材。
func findAsset(db *gorm.DB, id string) (model.Asset, bool, error) {
	item := model.Asset{}
	err := db.Where("id = ?", id).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Asset{}, false, nil
	}
	return item, err == nil, err
}

// applyAssetTagsFilter 应用 JSON 标签条件。
func applyAssetTagsFilter(tx *gorm.DB, tags []string) *gorm.DB {
	if len(tags) == 0 {
		return tx
	}
	condition := tx.Session(&gorm.Session{NewDB: true})
	for _, tag := range tags {
		condition = condition.Or(assetJSONTagsContains(tx), tag)
	}
	return tx.Where(condition)
}

func assetTagsFromItems(items []model.Asset) []string {
	seen := map[string]bool{}
	tags := []string{}
	for _, item := range items {
		for _, tag := range item.Tags {
			if tag != "" && !seen[tag] {
				seen[tag] = true
				tags = append(tags, tag)
			}
		}
	}
	return tags
}

// assetJSONTagsContains 返回素材 tags 的 JSON 包含条件。
func assetJSONTagsContains(tx *gorm.DB) string {
	switch tx.Dialector.Name() {
	case "mysql":
		return "JSON_CONTAINS(tags, JSON_QUOTE(?))"
	case "postgres":
		return "jsonb_exists(tags::jsonb, ?)"
	default:
		return "EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)"
	}
}

// isActiveAssetOption 判断素材筛选项有效状态。
func isActiveAssetOption(value string) bool {
	return value != "" && value != "全部" && value != "all"
}
