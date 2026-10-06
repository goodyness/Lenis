import argparse
import sys
from pathlib import Path
import uvicorn

# Ensure the root directory is at the head of sys.path across all spawned worker processes
ROOT_DIR = Path(__file__).resolve().parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def main():
    p = argparse.ArgumentParser(description="Start the Lenis dev server.")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--no-reload", action="store_true")
    p.add_argument("--log-level", default="info",
                   choices=["debug", "info", "warning", "error"])
    args = p.parse_args()

    log_cfg = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "default": {
                "()": "uvicorn.logging.DefaultFormatter",
                "fmt": "%(levelprefix)s %(message)s",
                "use_colors": True,
            },
            "access": {
                "()": "uvicorn.logging.AccessFormatter",
                "fmt": '%(levelprefix)s %(client_addr)s - "%(request_line)s" %(status_code)s',
                "use_colors": True,
            },
        },
        "handlers": {
            "default": {"formatter": "default", "class": "logging.StreamHandler",
                        "stream": "ext://sys.stderr"},
            "access": {"formatter": "access", "class": "logging.StreamHandler",
                       "stream": "ext://sys.stdout"},
        },
        "loggers": {
            "uvicorn":        {"handlers": ["default"], "level": "INFO", "propagate": False},
            "uvicorn.error":  {"level": "INFO"},
            "uvicorn.access": {"handlers": ["access"], "level": "INFO", "propagate": False},
            # All app.* loggers (auth, merchant, etc.) go to stderr at DEBUG
            "app":            {"handlers": ["default"], "level": "DEBUG", "propagate": False},
        },
    }

    app_dir = str((ROOT_DIR / "app").resolve())

    try:
        uvicorn.run(
            "app.main:app",
            host=args.host,
            port=args.port,
            reload=not args.no_reload,
            reload_dirs=[app_dir],
            reload_includes=["*.py"],
            reload_excludes=["*.pyc", "*__pycache__*", "*.db*", "*.sqlite*", "*.log", ".git*"],
            reload_delay=0.5,
            log_level=args.log_level,
            log_config=log_cfg,
        )
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    try:
        main()
    except (KeyboardInterrupt, SystemExit):
        sys.exit(0)
    except Exception:
        import os
        os._exit(1)

