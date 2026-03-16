package main

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi"
	"github.com/go-chi/render"
	uuid "github.com/satori/go.uuid"
)

var errInvalidStatus = errors.New("status must be OPEN, IN_PROGRESS, or CLOSED")

// ErrInternalServerError returns a 500 renderer.
func ErrInternalServerError(err error) render.Renderer {
	return &ErrResponse{
		Err:            err,
		HTTPStatusCode: 500,
		StatusText:     "internal server error",
		ErrorText:      err.Error(),
	}
}

func claudeAPI(r chi.Router) {
	// Key generation — protected by normal JWT + Admin auth (JWT verifier already global)
	r.Group(func(r chi.Router) {
		r.Use(RequireAccount())
		r.Use(RequireMember())
		r.Use(RequireAdmin())
		r.Post("/generate-api-key", generateClaudeAPIKey)
	})

	// All other Claude routes — authenticated via X-API-Key header
	r.Group(func(r chi.Router) {
		r.Use(RequireAPIKey())

		r.Get("/projects", getClaudeProjects)

		r.Route("/projects/{PROJECT_ID}", func(r chi.Router) {
			r.Get("/features", getClaudeFeatures)
			r.Post("/features", createClaudeFeature)
		})

		r.Route("/features/{ID}", func(r chi.Router) {
			r.Post("/status", updateClaudeStatus)
			r.Post("/annotations", updateClaudeAnnotations)
			r.Put("/description", updateClaudeDescription)
			r.Post("/move", moveClaudeFeature)
			r.Post("/comments", addClaudeComment)
		})
	})
}

// generateClaudeAPIKey creates and stores a new Claude API key for the workspace.
// Returns the raw key once — store it immediately.
func generateClaudeAPIKey(w http.ResponseWriter, r *http.Request) {
	s := GetEnv(r).Service
	rawKey := "fm_" + uuid.Must(uuid.NewV4(), nil).String()

	if err := s.SetClaudeAPIKey(s.GetMemberObject().WorkspaceID, rawKey); err != nil {
		_ = render.Render(w, r, ErrInternalServerError(err))
		return
	}

	render.JSON(w, r, map[string]string{"apiKey": rawKey})
}

func getClaudeProjects(w http.ResponseWriter, r *http.Request) {
	s := GetEnv(r).Service
	render.JSON(w, r, s.GetProjects())
}

// claudeFeaturesResponse is the enriched payload returned by get_features.
type claudeFeaturesResponse struct {
	Instructions    string            `json:"instructions"`
	Project         *Project          `json:"project"`
	Milestones      []*Milestone      `json:"milestones"`
	Workflows       []*Workflow       `json:"workflows"`
	SubWorkflows    []*SubWorkflow    `json:"subWorkflows"`
	Features        []*Feature        `json:"features"`
	FeatureComments []*FeatureComment `json:"featureComments"`
}

func getClaudeFeatures(w http.ResponseWriter, r *http.Request) {
	s := GetEnv(r).Service
	projectID := chi.URLParam(r, "PROJECT_ID")

	project := s.GetProject(projectID)
	if project == nil {
		http.Error(w, http.StatusText(404), 404)
		return
	}

	render.JSON(w, r, claudeFeaturesResponse{
		Instructions: "Read all features carefully. Use milestones and subWorkflows to understand " +
			"the story map structure. When updating feature status use: OPEN, IN_PROGRESS, or CLOSED. " +
			"Use annotations to record implementation decisions, PR links, and technical notes.",
		Project:         project,
		Milestones:      s.GetMilestonesByProject(projectID),
		Workflows:       s.GetWorkflowsByProject(projectID),
		SubWorkflows:    s.GetSubWorkflowsByProject(projectID),
		Features:        s.GetFeaturesByProject(projectID),
		FeatureComments: s.GetFeatureCommentsByProject(projectID),
	})
}

type claudeStatusRequest struct {
	Status string `json:"status"`
}

func updateClaudeStatus(w http.ResponseWriter, r *http.Request) {
	s := GetEnv(r).Service
	id := chi.URLParam(r, "ID")

	var body claudeStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		_ = render.Render(w, r, ErrInvalidRequest(err))
		return
	}

	var (
		f   *Feature
		err error
	)
	switch body.Status {
	case "OPEN", "IN_PROGRESS":
		f, err = s.OpenFeature(id)
	case "CLOSED":
		f, err = s.CloseFeature(id)
	default:
		_ = render.Render(w, r, ErrInvalidRequest(errInvalidStatus))
		return
	}
	if err != nil {
		_ = render.Render(w, r, ErrInvalidRequest(err))
		return
	}
	render.JSON(w, r, f)
}

type claudeAnnotationsRequest struct {
	Annotations string `json:"annotations"`
}

func updateClaudeAnnotations(w http.ResponseWriter, r *http.Request) {
	s := GetEnv(r).Service
	id := chi.URLParam(r, "ID")

	var body claudeAnnotationsRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		_ = render.Render(w, r, ErrInvalidRequest(err))
		return
	}

	f, err := s.UpdateAnnotationsOnFeature(id, body.Annotations)
	if err != nil {
		_ = render.Render(w, r, ErrInvalidRequest(err))
		return
	}
	render.JSON(w, r, f)
}

type claudeCreateFeatureRequest struct {
	SubWorkflowID string `json:"subWorkflowId"`
	MilestoneID   string `json:"milestoneId"`
	Title         string `json:"title"`
}

func createClaudeFeature(w http.ResponseWriter, r *http.Request) {
	s := GetEnv(r).Service

	var body claudeCreateFeatureRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		_ = render.Render(w, r, ErrInvalidRequest(err))
		return
	}

	f, err := s.CreateFeatureWithID(uuid.Must(uuid.NewV4(), nil).String(), body.SubWorkflowID, body.MilestoneID, body.Title)
	if err != nil {
		_ = render.Render(w, r, ErrInvalidRequest(err))
		return
	}
	render.Status(r, http.StatusCreated)
	render.JSON(w, r, f)
}

type claudeDescriptionRequest struct {
	Description string `json:"description"`
}

func updateClaudeDescription(w http.ResponseWriter, r *http.Request) {
	s := GetEnv(r).Service
	id := chi.URLParam(r, "ID")

	var body claudeDescriptionRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		_ = render.Render(w, r, ErrInvalidRequest(err))
		return
	}

	f, err := s.UpdateFeatureDescription(id, body.Description)
	if err != nil {
		_ = render.Render(w, r, ErrInvalidRequest(err))
		return
	}
	render.JSON(w, r, f)
}

type claudeMoveFeatureRequest struct {
	ToMilestoneID   string `json:"toMilestoneId"`
	ToSubWorkflowID string `json:"toSubWorkflowId"`
	Index           int    `json:"index"`
}

func moveClaudeFeature(w http.ResponseWriter, r *http.Request) {
	s := GetEnv(r).Service
	id := chi.URLParam(r, "ID")

	var body claudeMoveFeatureRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		_ = render.Render(w, r, ErrInvalidRequest(err))
		return
	}

	f, err := s.MoveFeature(id, body.ToMilestoneID, body.ToSubWorkflowID, body.Index)
	if err != nil {
		_ = render.Render(w, r, ErrInvalidRequest(err))
		return
	}
	render.JSON(w, r, f)
}

type claudeCommentRequest struct {
	Post string `json:"post"`
}

func addClaudeComment(w http.ResponseWriter, r *http.Request) {
	s := GetEnv(r).Service
	id := chi.URLParam(r, "ID")

	var body claudeCommentRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		_ = render.Render(w, r, ErrInvalidRequest(err))
		return
	}

	c, err := s.CreateFeatureCommentWithID(uuid.Must(uuid.NewV4(), nil).String(), id, body.Post)
	if err != nil {
		_ = render.Render(w, r, ErrInvalidRequest(err))
		return
	}
	render.Status(r, http.StatusCreated)
	render.JSON(w, r, c)
}
