package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type githubRoundTripper func(*http.Request) (*http.Response, error)

func (f githubRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func githubTestResponse(r *http.Request, status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: r}
}

func TestFetchGithubProfileUsesVerifiedPrimaryEmail(t *testing.T) {
	client := &http.Client{Transport: githubRoundTripper(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("Authorization = %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/user":
			return githubTestResponse(r, http.StatusOK, `{"id":12345,"login":"octocat","name":"Octo Cat","email":null}`), nil
		case "/user/emails":
			return githubTestResponse(r, http.StatusOK, `[{"email":"old@example.com","primary":false,"verified":true},{"email":"private@example.com","primary":true,"verified":true},{"email":"pending@example.com","primary":false,"verified":false}]`), nil
		default:
			return githubTestResponse(r, http.StatusNotFound, "not found"), nil
		}
	})}

	profile, err := fetchGithubProfile(context.Background(), client, "https://github.test", "test-token")
	if err != nil {
		t.Fatalf("fetchGithubProfile() error = %v", err)
	}
	if profile.ID != "12345" || profile.Login != "octocat" || profile.Name != "Octo Cat" || profile.Email != "private@example.com" {
		t.Fatalf("fetchGithubProfile() = %#v", profile)
	}
}

func TestFetchGithubProfileRequiresVerifiedPrimaryEmail(t *testing.T) {
	client := &http.Client{Transport: githubRoundTripper(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/user" {
			return githubTestResponse(r, http.StatusOK, `{"id":12345,"login":"octocat","name":"","email":"public@example.com"}`), nil
		}
		return githubTestResponse(r, http.StatusOK, `[{"email":"public@example.com","primary":true,"verified":false}]`), nil
	})}

	if _, err := fetchGithubProfile(context.Background(), client, "https://github.test", "test-token"); err == nil {
		t.Fatal("fetchGithubProfile() error = nil, want missing verified primary email")
	}
}
