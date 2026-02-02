import ipaddress
import math
import secrets
import socket
import time
from dataclasses import dataclass

import psutil
import requests

from config import ADS_CACHE_TTL_SECONDS


@dataclass
class CPUStat:
    cores: int
    percent: float


def cpu_usage() -> CPUStat:
    return CPUStat(cores=psutil.cpu_count(), percent=psutil.cpu_percent())


@dataclass
class RealtimeBandwidth:
    def __post_init__(self):
        io = psutil.net_io_counters()
        self.bytes_recv = io.bytes_recv
        self.bytes_sent = io.bytes_sent
        self.packets_recv = io.packets_recv
        self.packets_sent = io.packets_sent
        self.last_perf_counter = time.perf_counter()

    # data in the form of value per seconds
    incoming_bytes: int
    outgoing_bytes: int
    incoming_packets: int
    outgoing_packets: int

    bytes_recv: int = None
    bytes_sent: int = None
    packets_recv: int = None
    packets_sent: int = None
    last_perf_counter: float = None


@dataclass
class RealtimeBandwidthStat:
    """Real-Time bandwith in value/s unit"""

    incoming_bytes: int
    outgoing_bytes: int
    incoming_packets: int
    outgoing_packets: int


rt_bw = RealtimeBandwidth(incoming_bytes=0, outgoing_bytes=0, incoming_packets=0, outgoing_packets=0)


# sample time is 2 seconds, values lower than this may not produce good results
def record_realtime_bandwidth() -> None:
    global rt_bw
    last_perf_counter = rt_bw.last_perf_counter
    io = psutil.net_io_counters()
    rt_bw.last_perf_counter = time.perf_counter()
    sample_time = rt_bw.last_perf_counter - last_perf_counter
    rt_bw.incoming_bytes, rt_bw.bytes_recv = round((io.bytes_recv - rt_bw.bytes_recv) / sample_time), io.bytes_recv
    rt_bw.outgoing_bytes, rt_bw.bytes_sent = round((io.bytes_sent - rt_bw.bytes_sent) / sample_time), io.bytes_sent
    rt_bw.incoming_packets, rt_bw.packets_recv = (
        round((io.packets_recv - rt_bw.packets_recv) / sample_time),
        io.packets_recv,
    )
    rt_bw.outgoing_packets, rt_bw.packets_sent = (
        round((io.packets_sent - rt_bw.packets_sent) / sample_time),
        io.packets_sent,
    )


def register_scheduler_jobs(scheduler) -> None:
    from app.utils.ads import refresh_ads

    scheduler.add_job(
        record_realtime_bandwidth,
        "interval",
        seconds=2,
        coalesce=True,
        max_instances=1,
    )
    refresh_ads(force=True)
    scheduler.add_job(
        refresh_ads,
        "interval",
        seconds=max(ADS_CACHE_TTL_SECONDS, 60),
        args=[True],
        coalesce=True,
        max_instances=1,
    )

    # Register periodic users cache refresh job
    try:
        from app.jobs.refresh_users_cache import register_cache_refresh_job

        register_cache_refresh_job(scheduler)
    except Exception as e:
        import logging

        logger = logging.getLogger(__name__)
        logger.warning(f"Failed to register users cache refresh job: {e}", exc_info=True)


def realtime_bandwidth() -> RealtimeBandwidthStat:
    return RealtimeBandwidthStat(
        incoming_bytes=rt_bw.incoming_bytes,
        outgoing_bytes=rt_bw.outgoing_bytes,
        incoming_packets=rt_bw.incoming_packets,
        outgoing_packets=rt_bw.outgoing_packets,
    )


def random_password() -> str:
    return secrets.token_urlsafe(16)


def check_port(port: int) -> bool:
    s = socket.socket()
    try:
        s.connect(("127.0.0.1", port))
        return True
    except socket.error:
        return False
    finally:
        s.close()


def _is_global_ipv4(address: str) -> bool:
    try:
        return ipaddress.IPv4Address(address).is_global
    except ipaddress.AddressValueError:
        return False


def get_public_ip():
    try:
        resp = requests.get("http://api4.ipify.org/", timeout=5).text.strip()
        if _is_global_ipv4(resp):
            return resp
    except Exception:
        pass

    try:
        resp = requests.get("http://ipv4.icanhazip.com/", timeout=5).text.strip()
        if _is_global_ipv4(resp):
            return resp
    except Exception:
        pass

    try:
        requests.packages.urllib3.util.connection.HAS_IPV6 = False
        resp = requests.get("https://ifconfig.io/ip", timeout=5).text.strip()
        if _is_global_ipv4(resp):
            return resp
    except requests.exceptions.RequestException:
        pass
    finally:
        requests.packages.urllib3.util.connection.HAS_IPV6 = True

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        resp = sock.getsockname()[0]
        if _is_global_ipv4(resp):
            return resp
    except (socket.error, IndexError):
        pass
    finally:
        sock.close()

    return "127.0.0.1"


def get_public_ipv6():
    try:
        resp = requests.get("http://api6.ipify.org/", timeout=5).text.strip()
        if ipaddress.IPv6Address(resp).is_global:
            return "[%s]" % resp
    except Exception:
        pass

    try:
        resp = requests.get("http://ipv6.icanhazip.com/", timeout=5).text.strip()
        if ipaddress.IPv6Address(resp).is_global:
            return "[%s]" % resp
    except Exception:
        pass

    return "[::1]"


def readable_size(size_bytes):
    if size_bytes <= 0:
        return "0 B"
    size_name = ("B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB")
    i = int(math.floor(math.log(size_bytes, 1024)))
    p = math.pow(1024, i)
    s = round(size_bytes / p, 2)
    return f"{s} {size_name[i]}"


def start_redis_if_configured() -> None:
    """
    Start Redis server if configured to do so.
    Checks REDIS_AUTO_START environment variable and attempts to start Redis.
    """
    import logging
    import subprocess
    import shutil
    import time

    logger = logging.getLogger("uvicorn.error")

    try:
        from config import REDIS_ENABLED, REDIS_AUTO_START, REDIS_HOST, REDIS_PORT

        if not REDIS_ENABLED:
            return

        # Check if auto-start is enabled
        if not REDIS_AUTO_START:
            return

        # Check if Redis is already running
        if check_port(REDIS_PORT):
            logger.info(f"Redis is already running on {REDIS_HOST}:{REDIS_PORT}")
            return

        # Try to find redis-server executable
        redis_server = shutil.which("redis-server")
        if not redis_server:
            logger.warning(
                "redis-server not found in PATH, skipping auto-start. Install Redis or set REDIS_AUTO_START=false"
            )
            return

        logger.info("Starting Redis server...")
        try:
            # Start Redis in background
            # Use --daemonize yes for background execution
            process = subprocess.Popen(
                [redis_server, "--daemonize", "yes"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            stdout, stderr = process.communicate(timeout=5)

            if process.returncode == 0:
                # Wait a moment for Redis to start
                time.sleep(1)

                # Verify it's running
                if check_port(REDIS_PORT):
                    logger.info(f"Redis server started successfully on {REDIS_HOST}:{REDIS_PORT}")
                else:
                    logger.warning("Redis server process started but port is not accessible")
            else:
                error_msg = stderr.decode() if stderr else "Unknown error"
                logger.warning(f"Failed to start Redis server: {error_msg}")
        except subprocess.TimeoutExpired:
            process.kill()
            logger.warning("Redis server start command timed out")
        except Exception as e:
            logger.warning(f"Failed to start Redis server: {e}")

    except ImportError:
        # Config not available, skip
        pass
    except Exception as e:
        logger.warning(f"Error checking Redis auto-start configuration: {e}")
