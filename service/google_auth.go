package service

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type googleClaims struct {
	Redirect string `json:"redirect,omitempty"`
	Email    string `json:"email,omitempty"`
	Name     string `json:"name,omitempty"`
	jwt.RegisteredClaims
}

func GoogleConfigured() bool {
	c := config.Cfg
	u, err := url.Parse(c.GoogleRedirectURL)
	return c.GoogleClientID != "" && c.GoogleClientSecret != "" && err == nil && u.Host != "" && (u.Scheme == "https" || u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"))
}

func GoogleLoginOrigin() string {
	u, err := url.Parse(config.Cfg.GoogleRedirectURL)
	if err != nil || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func signGoogleClaims(claims googleClaims, purpose string) (string, error) {
	claims.Issuer = "infinite-canvas/" + purpose
	claims.IssuedAt = jwt.NewNumericDate(time.Now())
	claims.ExpiresAt = jwt.NewNumericDate(time.Now().Add(10 * time.Minute))
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(config.Cfg.JWTSecret))
}

func parseGoogleClaims(text, purpose string) (googleClaims, error) {
	var claims googleClaims
	token, err := jwt.ParseWithClaims(text, &claims, func(token *jwt.Token) (any, error) { return []byte(config.Cfg.JWTSecret), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("infinite-canvas/"+purpose), jwt.WithExpirationRequired())
	if err != nil || token == nil || !token.Valid {
		return claims, authMessage("Google 登录状态无效或已过期，请重新开始")
	}
	return claims, nil
}

func GoogleAuthorizeURL(redirect string) (string, string, error) {
	if !GoogleConfigured() {
		return "", "", authMessage("Google 登录还没配置，请联系管理员")
	}
	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		return "", "", err
	}
	state, err := signGoogleClaims(googleClaims{Redirect: safeRedirectPath(redirect), RegisteredClaims: jwt.RegisteredClaims{Subject: base64.RawURLEncoding.EncodeToString(nonce)}}, "google-state")
	if err != nil {
		return "", "", err
	}
	values := url.Values{"client_id": {config.Cfg.GoogleClientID}, "redirect_uri": {config.Cfg.GoogleRedirectURL}, "response_type": {"code"}, "scope": {"openid email profile"}, "state": {state}, "prompt": {"select_account"}}
	return "https://accounts.google.com/o/oauth2/v2/auth?" + values.Encode(), state, nil
}

func LoginWithGoogle(r *http.Request, code, state, cookieState string) (model.AuthSession, string, string, error) {
	claims, err := parseGoogleClaims(state, "google-state")
	if err != nil {
		return model.AuthSession{}, "", "/", err
	}
	redirect := safeRedirectPath(claims.Redirect)
	if state == "" || subtle.ConstantTimeCompare([]byte(state), []byte(cookieState)) != 1 {
		return model.AuthSession{}, "", redirect, authMessage("Google 登录校验失败，请重新开始")
	}
	if !GoogleConfigured() || code == "" {
		return model.AuthSession{}, "", redirect, authMessage("Google 登录未完成，请重试")
	}
	values := url.Values{"client_id": {config.Cfg.GoogleClientID}, "client_secret": {config.Cfg.GoogleClientSecret}, "redirect_uri": {config.Cfg.GoogleRedirectURL}, "grant_type": {"authorization_code"}, "code": {code}}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, "https://oauth2.googleapis.com/token", strings.NewReader(values.Encode()))
	if err != nil {
		return model.AuthSession{}, "", redirect, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if err := googleHTTP(req, &token); err != nil || token.AccessToken == "" {
		return model.AuthSession{}, "", redirect, authMessage("Google 授权失败，请重试")
	}
	req, err = http.NewRequestWithContext(r.Context(), http.MethodGet, "https://openidconnect.googleapis.com/v1/userinfo", nil)
	if err != nil {
		return model.AuthSession{}, "", redirect, err
	}
	req.Header.Set("Authorization", "Bearer "+token.AccessToken)
	var profile struct {
		Sub           string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
	}
	if err := googleHTTP(req, &profile); err != nil || profile.Sub == "" || !profile.EmailVerified {
		return model.AuthSession{}, "", redirect, authMessage("Google 未提供已验证的邮箱")
	}
	email, err := NormalizeAuthEmail(profile.Email)
	if err != nil {
		return model.AuthSession{}, "", redirect, err
	}
	user, exists, err := repository.GetUserByGoogleID(profile.Sub)
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
	pending, err := signGoogleClaims(googleClaims{Email: email, Name: profile.Name, RegisteredClaims: jwt.RegisteredClaims{Subject: profile.Sub}}, "google-registration")
	if err != nil {
		return model.AuthSession{}, "", redirect, err
	}
	if config.Cfg.RegistrationInviteRequired {
		return model.AuthSession{}, pending, redirect, nil
	}
	session, err := CompleteGoogleRegistration(pending, "")
	return session, "", redirect, err
}

func CompleteGoogleRegistration(pending, invite string) (model.AuthSession, error) {
	if !GoogleConfigured() {
		return model.AuthSession{}, authMessage("Google 登录还没配置，请联系管理员")
	}
	if err := checkRegistration(); err != nil {
		return model.AuthSession{}, err
	}
	claims, err := parseGoogleClaims(pending, "google-registration")
	if err != nil {
		return model.AuthSession{}, err
	}
	if claims.Subject == "" || claims.Email == "" {
		return model.AuthSession{}, authMessage("Google 用户信息无效")
	}
	invite, err = validateInvite(invite)
	if err != nil {
		return model.AuthSession{}, err
	}
	user := model.User{ID: newID("user"), Username: "google_" + strings.ReplaceAll(newID(""), "-", ""), Email: claims.Email, EmailKey: &claims.Email, GoogleID: &claims.Subject, DisplayName: claims.Name, Role: model.UserRoleUser, AffCode: newAffCode(), Status: model.UserStatusActive, CreatedAt: now(), UpdatedAt: now(), LastLoginAt: now()}
	if err := repository.RegisterVerifiedUser(user, invite, nil, time.Now().Unix()); err != nil {
		return model.AuthSession{}, authRepositoryError(err)
	}
	return newSession(user)
}

func googleHTTP(req *http.Request, dest any) error {
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return authMessage("Google 服务返回异常")
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(dest)
}
