package router

import (
	"github.com/gin-gonic/gin"
	"github.com/tigerowo/infinite-canvas/handler"
)

func registerTeamCollabRoutes(v1 *gin.RouterGroup) {
	v1.GET("/teams", gin.WrapF(handler.Teams))
	v1.POST("/teams", gin.WrapF(handler.Teams))
	team := func(c *gin.Context) { handler.Team(c.Writer, c.Request, c.Param("id")) }
	v1.GET("/teams/:id", team)
	v1.PATCH("/teams/:id", team)
	v1.DELETE("/teams/:id", team)
	v1.DELETE("/teams/:id/members/:userId", func(c *gin.Context) { handler.DeleteTeamMember(c.Writer, c.Request, c.Param("id"), c.Param("userId")) })
	v1.PATCH("/teams/:id/members/:userId", func(c *gin.Context) { handler.UpdateTeamMember(c.Writer, c.Request, c.Param("id"), c.Param("userId")) })
	v1.POST("/teams/:id/transfer", func(c *gin.Context) { handler.TransferTeam(c.Writer, c.Request, c.Param("id")) })
	v1.POST("/teams/:id/invites", func(c *gin.Context) { handler.CreateTeamInvite(c.Writer, c.Request, c.Param("id")) })
	v1.POST("/teams/:id/invites/:token/revoke", func(c *gin.Context) { handler.RevokeTeamInvite(c.Writer, c.Request, c.Param("id"), c.Param("token")) })
	sharedChannels := func(c *gin.Context) { handler.TeamSharedChannels(c.Writer, c.Request, c.Param("id")) }
	v1.GET("/teams/:id/shared-channels", sharedChannels)
	v1.PUT("/teams/:id/shared-channels", sharedChannels)
	v1.GET("/teams/:id/api-usage", func(c *gin.Context) { handler.TeamAPIUsage(c.Writer, c.Request, c.Param("id")) })
	v1.Any("/teams/:id/proxy/:channelId/*path", func(c *gin.Context) {
		handler.TeamAPIProxy(c.Writer, c.Request, c.Param("id"), c.Param("channelId"), c.Param("path"))
	})
	invite := func(c *gin.Context) { handler.TeamInvite(c.Writer, c.Request, c.Param("token")) }
	v1.GET("/team-invites/:token", invite)
	v1.POST("/team-invites/:token/accept", invite)
	assets := func(c *gin.Context) { handler.TeamAssets(c.Writer, c.Request, c.Param("id")) }
	v1.GET("/teams/:id/assets", assets)
	v1.POST("/teams/:id/assets", assets)
	asset := func(c *gin.Context) { handler.TeamAsset(c.Writer, c.Request, c.Param("id"), c.Param("assetId")) }
	v1.PATCH("/teams/:id/assets/:assetId", asset)
	v1.DELETE("/teams/:id/assets/:assetId", asset)
	project := func(c *gin.Context) { handler.CanvasProject(c.Writer, c.Request, c.Param("id")) }
	v1.GET("/canvas/projects/:id", project)
	v1.DELETE("/canvas/projects/:id", project)
	v1.POST("/canvas/projects/:id/move-to-team", func(c *gin.Context) { handler.MoveCanvasToTeam(c.Writer, c.Request, c.Param("id")) })
	access := func(c *gin.Context) { handler.CanvasAccess(c.Writer, c.Request, c.Param("id")) }
	v1.GET("/canvas/projects/:id/access", access)
	v1.PUT("/canvas/projects/:id/access", access)
	v1.GET("/canvas/projects/:id/snapshot", func(c *gin.Context) { handler.CanvasSnapshot(c.Writer, c.Request, c.Param("id")) })
	v1.POST("/canvas/projects/:id/patches", func(c *gin.Context) { handler.CanvasPatch(c.Writer, c.Request, c.Param("id")) })
	v1.GET("/canvas/projects/:id/changes", func(c *gin.Context) { handler.CanvasChanges(c.Writer, c.Request, c.Param("id")) })
}
