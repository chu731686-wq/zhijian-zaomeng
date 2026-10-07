package service

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type githubClaims struct {
	Redirect string `json:"redirect,omitempty"`
	Email    string `json:"email,omitempty"`
	Name     string `json:"name,omitempty"`
	Login    string `json:"login,omitempty"`
	jwt.RegisteredClaims
}

type githubProfile struct {
	ID    string
	Login string
	Name  string
	Email string
}

func GithubConfigured() bool {
	c := config.Cfg
	u, err := url.Parse(c.GithubRedirectURL)
	return c.GithubClientID != "" && c.GithubClientSecret != "" && err == nil && u.Host != "" && (u.Scheme == "https" || u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"))
}

func GithubLoginOrigin() string {
	u, err := url.Parse(config.Cfg.GithubRedirectURL)
	if err != nil || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func signGithubClaims(claims githubClaims, purpose string) (string, error) {
	claims.Issuer = "infinite-canvas/" + purpose
	claims.IssuedAt = jwt.NewNumericDate(time.Now())
	claims.ExpiresAt = jwt.NewNumericDate(time.Now().Add(10 * time.Minute))
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(config.Cfg.JWTSecret))
}

func parseGithubClaims(text, purpose string) (githubClaims, error) {
	var claims githubClaims
	token, err := jwt.ParseWithClaims(text, &claims, func(token *jwt.Token) (any, error) { return []byte(config.Cfg.JWTSecret), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("infinite-canvas/"+purpose), jwt.WithExpirationRequired())
	if err != nil || token == nil || !token.Valid {
		return claims, authMessage("GitHub 登录状态无效或已过期，请重新开始")
	}
	return claims, nil
}

func GithubAuthorizeURL(redirect string) (string, string, error) {
	if !GithubConfigured() {
		return "", "", authMessage("GitHub 登录还没配置，请联系管理员")
	}
	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		return "", "", err
	}
	state, err := signGithubClaims(githubClaims{Redirect: safeRedirectPath(redirect), RegisteredClaims: jwt.RegisteredClaims{Subject: base64.RawURLEncoding.EncodeToString(nonce)}}, "github-state")
	if err != nil {
		return "", "", err
	}
	values := url.Values{"client_id": {config.Cfg.GithubClientID}, "redirect_uri": {config.Cfg.GithubRedirectURL}, "scope": {"read:user user:email"}, "state": {state}}
	return "https://github.com/login/oauth/authorize?" + values.Encode(), state, nil
}

func LoginWithGithub(r *http.Request, code, state, cookieState string) (model.AuthSession, string, string, error) {
	claims, err := parseGithubClaims(state, "github-state")
	if err != nil {
		return model.AuthSession{}, "", "/", err
	}
	redirect := safeRedirectPath(claims.Redirect)
	if state == "" || subtle.ConstantTimeCompare([]byte(state), []byte(cookieState)) != 1 {
		return model.AuthSession{}, "", redirect, authMessage("GitHub 登录校验失败，请重新开始")
	}
	if !GithubConfigured() || code == "" {
		return model.AuthSession{}, "", redirect, authMessage("GitHub 登录未完成，请重试")
	}
	values := url.Values{"client_id": {config.Cfg.GithubClientID}, "client_secret": {config.Cfg.GithubClientSecret}, "redirect_uri": {config.Cfg.GithubRedirectURL}, "code": {code}}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, "https://github.com/login/oauth/access_token", strings.NewReader(values.Encode()))
	if err != nil {
		return model.AuthSession{}, "", redirect, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var token struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := githubHTTP(req, &token); err != nil || token.AccessToken == "" {
		return model.AuthSession{}, "", redirect, authMessage("GitHub 授权失败，请重试")
	}
	profile, err := fetchGithubProfile(r.Context(), http.DefaultClient, "https://api.github.com", token.AccessToken)
	if err != nil {
		return model.AuthSession{}, "", redirect, authMessage("GitHub 未提供已验证的主邮箱")
	}
	user, exists, err := repository.GetUserByGithubID(profile.ID)
	if err != nil {
		return model.AuthSession{}, "", redirect, err
	}
	if exists {
		if user.Status == model.UserStatusBan {
			return model.AuthSession{}, "", redirect, authMessage("账号已被禁用")
		}
		user.LastLoginAt, user.UpdatedAt = now(), now()
		user, err = repository.SaveUser(user)
		if err != nil {
			return model.AuthSession{}, "", redirect, err
		}
		session, err := newSession(user)
		return session, "", redirect, err
	}
	if err := checkRegistration(); err != nil {
		return model.AuthSession{}, "", redirect, err
	}
	pending, err := signGithubClaims(githubClaims{Email: profile.Email, Login: profile.Login, Name: profile.Name, RegisteredClaims: jwt.RegisteredClaims{Subject: profile.ID}}, "github-registration")
	if err != nil {
		return model.AuthSession{}, "", redirect, err
	}
	if config.Cfg.RegistrationInviteRequired {
		return model.AuthSession{}, pending, redirect, nil
	}
	session, err := CompleteGithubRegistration(pending, "")
	return session, "", redirect, err
}

func CompleteGithubRegistration(pending, invite string) (model.AuthSession, error) {
	if !GithubConfigured() {
		return model.AuthSession{}, authMessage("GitHub 登录还没配置，请联系管理员")
	}
	if err := checkRegistration(); err != nil {
		return model.AuthSession{}, err
	}
	claims, err := parseGithubClaims(pending, "github-registration")
	if err != nil {
		return model.AuthSession{}, err
	}
	if claims.Subject == "" || claims.Email == "" {
		return model.AuthSession{}, authMessage("GitHub 用户信息无效")
	}
	invite, err = validateInvite(invite)
	if err != nil {
		return model.AuthSession{}, err
	}
	email, err := NormalizeAuthEmail(claims.Email)
	if err != nil {
		return model.AuthSession{}, err
	}
	username := "github_" + strings.ReplaceAll(newID(""), "-", "")
	displayName := claims.Name
	if strings.TrimSpace(displayName) == "" {
		displayName = claims.Login
	}
	user := model.User{ID: newID("user"), Username: username, Email: email, EmailKey: &email, GithubID: claims.Subject, DisplayName: displayName, Role: model.UserRoleUser, AffCode: newAffCode(), Status: model.UserStatusActive, CreatedAt: now(), UpdatedAt: now(), LastLoginAt: now()}
	if err := repository.RegisterVerifiedUser(user, invite, nil, time.Now().Unix()); err != nil {
		return model.AuthSession{}, authRepositoryError(err)
	}
	return newSession(user)
}

func fetchGithubProfile(ctx context.Context, client *http.Client, apiBase, accessToken string) (githubProfile, error) {
	apiBase = strings.TrimRight(apiBase, "/")
	profileReq, err := http.NewRequestWithContext(ctx, http.MethodGet, apiBase+"/user", nil)
	if err != nil {
		return githubProfile{}, err
	}
	profileReq.Header.Set("Authorization", "Bearer "+accessToken)
	profileReq.Header.Set("Accept", "application/vnd.github+json")
	profileReq.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	var profileResponse struct {
		ID    int64  `json:"id"`
		Login string `json:"login"`
		Name  string `json:"name"`
	}
	if err := githubHTTPWithClient(client, profileReq, &profileResponse); err != nil {
		return githubProfile{}, err
	}
	if profileResponse.ID <= 0 || strings.TrimSpace(profileResponse.Login) == "" {
		return githubProfile{}, fmt.Errorf("invalid GitHub user profile")
	}
	emailsReq, err := http.NewRequestWithContext(ctx, http.MethodGet, apiBase+"/user/emails", nil)
	if err != nil {
		return githubProfile{}, err
	}
	emailsReq.Header = profileReq.Header.Clone()
	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := githubHTTPWithClient(client, emailsReq, &emails); err != nil {
		return githubProfile{}, err
	}
	var email string
	for _, candidate := range emails {
		if candidate.Primary && candidate.Verified {
			email = candidate.Email
			break
		}
	}
	if email == "" {
		return githubProfile{}, fmt.Errorf("GitHub did not return a verified primary email")
	}
	name := strings.TrimSpace(profileResponse.Name)
	if name == "" {
		name = profileResponse.Login
	}
	return githubProfile{ID: strconv.FormatInt(profileResponse.ID, 10), Login: profileResponse.Login, Name: name, Email: email}, nil
}

func githubHTTP(req *http.Request, dest any) error {
	return githubHTTPWithClient(&http.Client{Timeout: 15 * time.Second}, req, dest)
}

func githubHTTPWithClient(client *http.Client, req *http.Request, dest any) error {
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return authMessage("GitHub 服务返回异常")
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(dest)
}
