package service

import (
	"crypto/sha256"
	"embed"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/goccy/go-yaml"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

//go:embed skills
var defaultAgentSkillFS embed.FS

type defaultAgentSkillMetadata struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
}

type defaultAgentSkillPackage struct {
	Root        string
	Name        string
	Description string
	Content     string
	Files       []model.AgentSkillFile
}

// EnsureDefaultAgentSkills 导入首次安装的预置 Skill，并在每次启动时同步预置包。
func EnsureDefaultAgentSkills() error {
	initialized, err := repository.AgentSkillsInitialized()
	if err != nil {
		return err
	}
	existing, err := repository.ListSystemAgentSkills()
	if err != nil {
		return err
	}
	packages, err := readDefaultAgentSkillPackages()
	if err != nil {
		return err
	}
	current := now()
	if !initialized {
		if len(existing) == 0 {
			items := make([]model.AgentSkill, 0, len(packages))
			fileGroups := make([][]model.AgentSkillFile, 0, len(packages))
			for index, item := range packages {
				id := defaultAgentSkillID(item.Root)
				files, err := normalizeAgentSkillFiles(id, item.Files, current)
				if err != nil {
					return err
				}
				items = append(items, model.AgentSkill{
					ID: id, Source: model.AgentSkillSourceSystem, Name: item.Name, Description: item.Description,
					Content: item.Content, Enabled: true, Sort: index, CreatedAt: current, UpdatedAt: current,
				})
				fileGroups = append(fileGroups, files)
			}
			if err := repository.InitializeAgentSkills(items, fileGroups, current); err != nil {
				return err
			}
			return nil
		}
		if err := repository.MarkAgentSkillsInitialized(current); err != nil {
			return err
		}
	}

	maxSort := -1
	for _, item := range existing {
		if item.Sort > maxSort {
			maxSort = item.Sort
		}
	}
	for _, pkg := range packages {
		id := defaultAgentSkillID(pkg.Root)
		files, err := normalizeAgentSkillFiles(id, pkg.Files, current)
		if err != nil {
			return err
		}
		stored, found, err := repository.GetAgentSkill(id)
		if err != nil {
			return err
		}
		if found && stored.Source != model.AgentSkillSourceSystem {
			continue
		}
		if found {
			storedFiles, err := repository.ListAgentSkillFiles(id)
			if err != nil {
				return err
			}
			if stored.Name == pkg.Name && stored.Description == pkg.Description && stored.Content == pkg.Content && defaultAgentSkillFilesEqual(storedFiles, files) {
				continue
			}
			stored.Name = pkg.Name
			stored.Description = pkg.Description
			stored.Content = pkg.Content
			stored.UpdatedAt = current
			if _, err := repository.SaveAgentSkillPackage(stored, files); err != nil {
				return err
			}
			continue
		}
		maxSort++
		item := model.AgentSkill{
			ID: id, Source: model.AgentSkillSourceSystem, Name: pkg.Name, Description: pkg.Description,
			Content: pkg.Content, Enabled: true, Sort: maxSort, CreatedAt: current, UpdatedAt: current,
		}
		if _, err := repository.SaveAgentSkillPackage(item, files); err != nil {
			return err
		}
	}
	return nil
}

func defaultAgentSkillFilesEqual(stored []model.AgentSkillFile, defaults []model.AgentSkillFile) bool {
	if len(stored) != len(defaults) {
		return false
	}
	stored = append([]model.AgentSkillFile(nil), stored...)
	defaults = append([]model.AgentSkillFile(nil), defaults...)
	sort.Slice(stored, func(i, j int) bool { return stored[i].Path < stored[j].Path })
	sort.Slice(defaults, func(i, j int) bool { return defaults[i].Path < defaults[j].Path })
	for index := range stored {
		if stored[index].Path != defaults[index].Path || stored[index].Kind != defaults[index].Kind || stored[index].Content != defaults[index].Content || stored[index].Sort != defaults[index].Sort {
			return false
		}
	}
	return true
}

func readDefaultAgentSkillPackages() ([]defaultAgentSkillPackage, error) {
	var entries []string
	var roots []string
	err := fs.WalkDir(defaultAgentSkillFS, "skills", func(filePath string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		entries = append(entries, filePath)
		if !entry.IsDir() {
			if path.Dir(filePath) == "skills" && strings.EqualFold(path.Ext(filePath), ".md") {
				roots = append(roots, filePath)
			} else if strings.EqualFold(path.Base(filePath), "SKILL.md") {
				roots = append(roots, path.Dir(filePath))
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(roots)
	packages := make([]defaultAgentSkillPackage, 0, len(roots))
	for _, root := range roots {
		rootEntry, err := fs.Stat(defaultAgentSkillFS, root)
		if err != nil {
			return nil, err
		}
		skillPath := root
		if rootEntry.IsDir() {
			skillPath = path.Join(root, "SKILL.md")
		}
		data, err := defaultAgentSkillFS.ReadFile(skillPath)
		if err != nil {
			return nil, err
		}
		content := string(data)
		metadata := parseDefaultAgentSkillMetadata(content)
		name := strings.TrimSpace(metadata.Name)
		if name == "" {
			name = path.Base(root)
			if !rootEntry.IsDir() {
				name = strings.TrimSuffix(name, path.Ext(name))
			}
		}
		if strings.TrimSpace(content) == "" || utf8.RuneCountInString(content) > maxAgentSkillContentLength {
			return nil, fmt.Errorf("默认 Skill %s 的 SKILL.md 为空或超过 20000 字", root)
		}
		item := defaultAgentSkillPackage{Root: root, Name: name, Description: strings.TrimSpace(metadata.Description), Content: content}
		if !rootEntry.IsDir() {
			packages = append(packages, item)
			continue
		}
		for _, filePath := range entries {
			if filePath == root || filePath == skillPath || defaultAgentSkillRoot(filePath, roots) != root {
				continue
			}
			entry, err := fs.Stat(defaultAgentSkillFS, filePath)
			if err != nil {
				return nil, err
			}
			relativePath := strings.TrimPrefix(strings.TrimPrefix(filePath, root), "/")
			file := model.AgentSkillFile{Path: relativePath, Kind: model.AgentSkillFileKindFolder, Sort: len(item.Files)}
			if !entry.IsDir() {
				data, err := defaultAgentSkillFS.ReadFile(filePath)
				if err != nil {
					return nil, err
				}
				file.Kind = model.AgentSkillFileKindFile
				file.Content = string(data)
			}
			item.Files = append(item.Files, file)
		}
		packages = append(packages, item)
	}
	return packages, nil
}

func defaultAgentSkillRoot(filePath string, roots []string) string {
	result := ""
	for _, root := range roots {
		if (filePath == root || strings.HasPrefix(filePath, root+"/")) && len(root) > len(result) {
			result = root
		}
	}
	return result
}

func parseDefaultAgentSkillMetadata(content string) defaultAgentSkillMetadata {
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	if !strings.HasPrefix(normalized, "---\n") {
		return defaultAgentSkillMetadata{}
	}
	rest := strings.TrimPrefix(normalized, "---\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return defaultAgentSkillMetadata{}
	}
	var metadata defaultAgentSkillMetadata
	_ = yaml.Unmarshal([]byte(rest[:end]), &metadata)
	return metadata
}

func defaultAgentSkillID(root string) string {
	sum := sha256.Sum256([]byte(root))
	return fmt.Sprintf("agent-skill-default-%x", sum[:8])
}
