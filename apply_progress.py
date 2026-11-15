"""Track an Apply request without holding the lock that protects game files."""
from contextlib import contextmanager
import re
from threading import Lock


class ApplyProgress:
    def __init__(self):
        self._lock = Lock()
        self._jobs = {}

    def status(self, token):
        self._validate(token)
        with self._lock:
            return dict(self._jobs.get(token, {'percent': 0, 'message': 'Waiting to start', 'state': 'waiting'}))

    @staticmethod
    def _validate(token):
        if not isinstance(token, str) or not re.fullmatch(r'[0-9a-f]{32}', token):
            raise ValueError('Invalid Apply progress identifier')

    @contextmanager
    def track(self, token):
        if token is None:
            yield lambda percent, message: None
            return
        self._validate(token)
        with self._lock:
            if token in self._jobs:
                raise FileExistsError('This Apply request already started')
            for key in list(self._jobs):
                if len(self._jobs) < 24:
                    break
                if self._jobs[key]['state'] != 'running':
                    del self._jobs[key]
            if len(self._jobs) >= 24:
                raise ValueError('Too many Apply requests are active')
            self._jobs[token] = {'percent': 0, 'message': 'Waiting to start', 'state': 'running'}

        def update(percent, message):
            with self._lock:
                self._jobs[token] = {'percent': percent, 'message': message, 'state': 'running'}

        try:
            yield update
        except Exception as error:
            with self._lock:
                self._jobs[token].update(state='failed', message=str(error) or 'Apply failed')
            raise
        else:
            with self._lock:
                self._jobs[token].update(percent=100, state='complete', message='Complete')
