# Synthetic fixture module (read-only sample). Never executed by the auditor.
from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health():
    return {"status": "ok"}
