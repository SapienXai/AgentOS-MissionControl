#!/usr/bin/env python3
"""Run an interactive command behind a real pseudo-terminal."""

import errno
import os
import pty
import select
import signal
import sys
import time


if len(sys.argv) < 2:
    print("A command is required.", file=sys.stderr)
    sys.exit(2)


child_pid = None
master_fd = None
child_status = None
stop_started = None


def forward_signal(signum, _frame):
    global stop_started
    if stop_started is None:
        stop_started = time.monotonic()
    if child_pid is None:
        return
    try:
        # pty.fork creates a new session. The CLI may spawn the actual
        # callback listener beneath itself, so signal the entire PTY group.
        os.killpg(child_pid, signum)
    except ProcessLookupError:
        pass


signal.signal(signal.SIGTERM, forward_signal)
signal.signal(signal.SIGINT, forward_signal)

child_pid, master_fd = pty.fork()
if child_pid == 0:
    os.execvpe(sys.argv[1], sys.argv[1:], os.environ)


stdin_fd = sys.stdin.fileno()
stdin_open = True

try:
    while child_status is None:
        if stop_started is not None and time.monotonic() - stop_started >= 0.75:
            forward_signal(signal.SIGKILL, None)
        read_fds = [master_fd]
        if stdin_open:
            read_fds.append(stdin_fd)

        try:
            ready, _, _ = select.select(read_fds, [], [], 0.25)
        except InterruptedError:
            continue

        if master_fd in ready:
            try:
                data = os.read(master_fd, 8192)
            except OSError as error:
                if error.errno == errno.EIO:
                    data = b""
                else:
                    raise

            if data:
                os.write(sys.stdout.fileno(), data)
            else:
                break

        if stdin_open and stdin_fd in ready:
            data = os.read(stdin_fd, 8192)
            if data:
                os.write(master_fd, data)
            else:
                stdin_open = False
                # The owning backend closed or crashed. Never leave OAuth
                # and its callback listener alive after the pipe closes.
                forward_signal(signal.SIGTERM, None)

        finished_pid, status = os.waitpid(child_pid, os.WNOHANG)
        if finished_pid == child_pid:
            child_status = status
finally:
    # PTY EOF can arrive just before waitpid reports the child's natural exit.
    # Reap that exit before cleaning descendants so cleanup cannot turn a
    # successfully persisted OAuth login into a failed command.
    if child_status is None and child_pid is not None:
        exit_deadline = time.monotonic() + 0.75
        while time.monotonic() < exit_deadline:
            finished_pid, status = os.waitpid(child_pid, os.WNOHANG)
            if finished_pid == child_pid:
                child_status = status
                break
            time.sleep(0.01)

    if child_pid is not None:
        try:
            os.killpg(child_pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError:
            # Darwin may return EPERM for the empty group of an exited child.
            # Never suppress it while the owned child is still running.
            if child_status is None:
                raise
    if child_status is None and child_pid is not None:
        _, child_status = os.waitpid(child_pid, 0)

    if master_fd is not None:
        os.close(master_fd)


if os.WIFEXITED(child_status):
    sys.exit(os.WEXITSTATUS(child_status))
if os.WIFSIGNALED(child_status):
    sys.exit(128 + os.WTERMSIG(child_status))
sys.exit(1)
