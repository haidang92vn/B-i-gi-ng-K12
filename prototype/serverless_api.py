"""Stateless FastAPI app factory, suitable for a Vercel Python entry point."""
from __future__ import annotations

import io

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse

from prototype.course_models import Course
from prototype.serverless_core import ScormRenderer, StatelessExportRequest, StatelessGenerateRequest, StatelessModeError, make_mock_course, package_course, preview_course, quality_report


def create_serverless_app(renderer: ScormRenderer) -> FastAPI:
    app = FastAPI(title="AI SCORM Studio serverless API")

    @app.get("/healthz")
    def healthz():
        return {"status": "ok", "mode": "stateless"}

    @app.post("/api/serverless/generate")
    def generate(payload: StatelessGenerateRequest):
        course = make_mock_course(payload)
        return {"course": course.model_dump(mode="json"), "provider": "mock", "notice": "Mock AI không gửi nội dung sang dịch vụ bên ngoài."}

    @app.post("/api/serverless/quality")
    def quality(course: Course):
        return quality_report(course)

    @app.post("/api/serverless/preview", response_class=HTMLResponse)
    def preview(course: Course):
        try:
            return preview_course(course, renderer)
        except StatelessModeError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post("/api/serverless/export")
    def export(payload: StatelessExportRequest):
        try:
            package, filename = package_course(payload.course, renderer)
        except StatelessModeError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return StreamingResponse(io.BytesIO(package), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    return app
