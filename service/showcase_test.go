package service

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func TestShowcaseProjectPublishingAndPermissions(t *testing.T) {
	const childMarker = "SHOWCASE_TEST_CHILD"
	if os.Getenv(childMarker) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestShowcaseProjectPublishingAndPermissions$", "-test.timeout=40s")
		cmd.Env = append(os.Environ(), childMarker+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated showcase test: %v\n%s", err, output)
		}
		return
	}

	previousConfig := config.Cfg
	config.Cfg = config.Config{
		StorageDriver: "sqlite",
		DatabaseDSN:   filepath.Join(t.TempDir(), "showcase.db"),
		AILogDir:      t.TempDir(),
	}
	t.Cleanup(func() { config.Cfg = previousConfig })

	db, err := repository.DB()
	if err != nil {
		t.Fatalf("open temporary database: %v", err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatalf("get database connection: %v", err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })

	admin := model.User{ID: "showcase-admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	ordinary := model.User{ID: "showcase-ordinary", Username: "ordinary", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(&[]model.User{admin, ordinary}).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}
	projectAData := `{"title":"A","nodes":[{"id":"server:file-a"}]}`
	projectBData := `{"title":"B","nodes":[{"id":"server:file-b"}]}`
	projects := []model.CanvasProject{
		{UserID: admin.ID, ID: "A", ProjectData: projectAData, CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z"},
		{UserID: admin.ID, ID: "B", ProjectData: projectBData, CreatedAt: "2026-01-02T00:00:00Z", UpdatedAt: "2026-01-02T00:00:00Z"},
	}
	if err := db.Create(&projects).Error; err != nil {
		t.Fatalf("create canvas projects: %v", err)
	}

	ctx := context.Background()
	adminUser, ordinaryUser := model.PublicUser(admin), model.PublicUser(ordinary)
	if err := SetProjectPublished(ctx, adminUser, "A", true); err != nil {
		t.Fatalf("admin publishing project A: %v", err)
	}
	if err := SetProjectPublished(ctx, ordinaryUser, "A", true); err == nil {
		t.Fatal("ordinary user should not be allowed to publish a project")
	}
	if err := SetProjectPublished(ctx, adminUser, "missing", true); err == nil {
		t.Fatal("publishing a nonexistent project should fail")
	}

	showcase, err := ListShowcaseProjects()
	if err != nil {
		t.Fatalf("ListShowcaseProjects returned error: %v", err)
	}
	if len(showcase) != 1 {
		t.Fatalf("showcase projects = %#v, want only project A", showcase)
	}
	if showcase[0].ID != "A" || showcase[0].Title != "A" || showcase[0].OwnerName != "admin" {
		t.Errorf("showcase project = %#v, want ID=A, Title=A, OwnerName=admin", showcase[0])
	}

	project, err := GetShowcaseProject("A")
	if err != nil {
		t.Fatalf("GetShowcaseProject(A) returned error: %v", err)
	}
	if project.ID != "A" || project.ProjectData != projectAData {
		t.Errorf("GetShowcaseProject(A) = %#v, want project data %q", project, projectAData)
	}
	if _, err := GetShowcaseProject("B"); err == nil || !strings.Contains(err.Error(), "不存在") {
		t.Errorf("GetShowcaseProject(B) error = %v, want nonexistent-project error", err)
	}
	if !CanReadFileForShowcase(ordinaryUser, "file-a") {
		t.Error("ordinary user should be able to read file-a from the showcase project")
	}
	if CanReadFileForShowcase(ordinaryUser, "file-b") {
		t.Error("ordinary user should not be able to read file-b from an unpublished project")
	}

	if err := SetProjectPublished(ctx, adminUser, "A", false); err != nil {
		t.Fatalf("admin unpublishing project A: %v", err)
	}
	showcase, err = ListShowcaseProjects()
	if err != nil {
		t.Fatalf("ListShowcaseProjects after unpublishing returned error: %v", err)
	}
	if len(showcase) != 0 {
		t.Errorf("showcase projects after unpublishing = %#v, want empty", showcase)
	}
}
