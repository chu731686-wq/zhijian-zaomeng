package handler

import (
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/service"
)

func decodeAuthRequest(w http.ResponseWriter, r *http.Request, dest any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	if err := json.NewDecoder(r.Body).Decode(dest); err != nil {
		Fail(w, "请求格式无效")
		return false
	}
	return true
}

func AuthOptions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	OK(w, map[string]any{"mailConfigured": service.SMTPConfigured(), "googleEnabled": service.GoogleConfigured(), "githubEnabled": service.GithubConfigured(), "inviteRequired": config.Cfg.RegistrationInviteRequired})
}

func SendEmailCode(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Email   string `json:"email"`
		Purpose string `json:"purpose"`
	}
	if !decodeAuthRequest(w, r, &request) {
		return
	}
	result, err := service.SendEmailCode(request.Email, request.Purpose, service.AuthClientIP(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func ResetEmailPassword(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Email    string `json:"email"`
		Code     string `json:"code"`
		Password string `json:"password"`
	}
	if !decodeAuthRequest(w, r, &request) {
		return
	}
	session, err := service.ResetEmailPassword(request.Email, request.Code, request.Password, service.AuthClientIP(r))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, session)
}

func googleCookie(value string, maxAge int) *http.Cookie {
	u, _ := url.Parse(config.Cfg.GoogleRedirectURL)
	return &http.Cookie{Name: "google_oauth_state", Value: value, Path: "/api/auth/google", MaxAge: maxAge, HttpOnly: true, Secure: u != nil && u.Scheme == "https", SameSite: http.SameSiteLaxMode}
}

func GoogleAuthorize(w http.ResponseWriter, r *http.Request) {
	if err := service.AuthRate("google-ip", service.AuthClientIP(r), 600, 30); err != nil {
		FailError(w, err)
		return
	}
	authURL, state, err := service.GoogleAuthorizeURL(r.URL.Query().Get("redirect"))
	if err != nil {
		FailError(w, err)
		return
	}
	http.SetCookie(w, googleCookie(state, 600))
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, authURL, http.StatusFound)
}

func GoogleCallback(w http.ResponseWriter, r *http.Request) {
	cookieState := ""
	if cookie, err := r.Cookie("google_oauth_state"); err == nil {
		cookieState = cookie.Value
	}
	http.SetCookie(w, googleCookie("", -1))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	session, pending, redirect, err := service.LoginWithGoogle(r, r.URL.Query().Get("code"), r.URL.Query().Get("state"), cookieState)
	fragment := url.Values{}
	if err != nil {
		message := "Google 登录失败，请重试"
		if safe, ok := err.(interface{ SafeMessage() string }); ok {
			message = safe.SafeMessage()
		}
		fragment.Set("error", message)
	} else if pending != "" {
		fragment.Set("googlePending", pending)
	} else {
		fragment.Set("authToken", session.Token)
	}
	http.Redirect(w, r, service.GoogleLoginOrigin()+"/login?"+url.Values{"redirect": {redirect}}.Encode()+"#"+fragment.Encode(), http.StatusFound)
}

func GoogleRegister(w http.ResponseWriter, r *http.Request) {
	if err := service.AuthRate("google-register-ip", service.AuthClientIP(r), 600, 30); err != nil {
		FailError(w, err)
		return
	}
	var request struct {
		PendingToken string `json:"pendingToken"`
		InviteCode   string `json:"inviteCode"`
	}
	if !decodeAuthRequest(w, r, &request) {
		return
	}
	session, err := service.CompleteGoogleRegistration(request.PendingToken, request.InviteCode)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, session)
}

func githubCookie(value string, maxAge int) *http.Cookie {
	u, _ := url.Parse(config.Cfg.GithubRedirectURL)
	return &http.Cookie{Name: "github_oauth_state", Value: value, Path: "/api/auth/github", MaxAge: maxAge, HttpOnly: true, Secure: u != nil && u.Scheme == "https", SameSite: http.SameSiteLaxMode}
}

func GithubAuthorize(w http.ResponseWriter, r *http.Request) {
	if err := service.AuthRate("github-ip", service.AuthClientIP(r), 600, 30); err != nil {
		FailError(w, err)
		return
	}
	authURL, state, err := service.GithubAuthorizeURL(r.URL.Query().Get("redirect"))
	if err != nil {
		FailError(w, err)
		return
	}
	http.SetCookie(w, githubCookie(state, 600))
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, authURL, http.StatusFound)
}

func GithubCallback(w http.ResponseWriter, r *http.Request) {
	cookieState := ""
	if cookie, err := r.Cookie("github_oauth_state"); err == nil {
		cookieState = cookie.Value
	}
	http.SetCookie(w, githubCookie("", -1))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	session, pending, redirect, err := service.LoginWithGithub(r, r.URL.Query().Get("code"), r.URL.Query().Get("state"), cookieState)
	fragment := url.Values{}
	if err != nil {
		message := "GitHub 登录失败，请重试"
		if safe, ok := err.(interface{ SafeMessage() string }); ok {
			message = safe.SafeMessage()
		}
		fragment.Set("error", message)
	} else if pending != "" {
		fragment.Set("githubPending", pending)
	} else {
		fragment.Set("authToken", session.Token)
	}
	http.Redirect(w, r, service.GithubLoginOrigin()+"/login?"+url.Values{"redirect": {redirect}}.Encode()+"#"+fragment.Encode(), http.StatusFound)
}

func GithubRegister(w http.ResponseWriter, r *http.Request) {
	if err := service.AuthRate("github-register-ip", service.AuthClientIP(r), 600, 30); err != nil {
		FailError(w, err)
		return
	}
	var request struct {
		PendingToken string `json:"pendingToken"`
		InviteCode   string `json:"inviteCode"`
	}
	if !decodeAuthRequest(w, r, &request) {
		return
	}
	session, err := service.CompleteGithubRegistration(request.PendingToken, request.InviteCode)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, session)
}

func AdminInvites(w http.ResponseWriter, r *http.Request) {
	items, err := service.ListInvites()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, items)
}

func AdminCreateInvite(w http.ResponseWriter, r *http.Request) {
	user, _ := service.UserFromContext(r.Context())
	invite, err := service.CreateInvite(user.ID)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, invite)
}

func AdminRevokeInvite(w http.ResponseWriter, r *http.Request, code string) {
	if err := service.RevokeInvite(code); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}
