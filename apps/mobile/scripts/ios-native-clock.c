#include <errno.h>
#include <inttypes.h>
#include <mach/mach_time.h>
#include <os/log.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#ifdef FM_HOST
#include <libproc.h>
#include <sys/resource.h>
#endif

static void json_string(const char *value) {
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)value; *p; p++) {
    if (*p == '"' || *p == '\\') printf("\\%c", *p);
    else if (*p < 32) printf("\\u%04x", *p);
    else putchar(*p);
  }
  putchar('"');
}

static int snapshot(const char *token) {
  mach_timebase_info_data_t base;
  if (mach_timebase_info(&base) != KERN_SUCCESS || !base.denom) return 1;
  uint64_t absolute_before = mach_absolute_time();
  uint64_t continuous_before = mach_continuous_time();
  if (token) {
    os_log_t logger = os_log_create("ph.freshmarkets.native-clock", "calibration");
    os_log_info(logger, "FM_IOS_CLOCK %{public}s", token);
  }
  uint64_t continuous_after = mach_continuous_time();
  uint64_t absolute_after = mach_absolute_time();
  printf("{\"pid\":%d,\"numer\":%u,\"denom\":%u,\"absoluteBefore\":\"%" PRIu64
         "\",\"absoluteAfter\":\"%" PRIu64 "\",\"continuousBefore\":\"%" PRIu64
         "\",\"continuousAfter\":\"%" PRIu64 "\"", getpid(), base.numer, base.denom,
         absolute_before, absolute_after, continuous_before, continuous_after);
  if (token) { printf(",\"token\":"); json_string(token); }
  puts("}");
  return 0;
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "snapshot") == 0) return snapshot(NULL);
  if (argc == 3 && strcmp(argv[1], "calibrate") == 0) {
    if (!argv[2][0] || strlen(argv[2]) > 80) return 2;
    for (const char *p = argv[2]; *p; p++)
      if (!((*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9') || *p == '-')) return 2;
    return snapshot(argv[2]);
  }
#ifdef FM_HOST
  if (argc == 3 && strcmp(argv[1], "process") == 0) {
    char *end;
    errno = 0;
    long raw_pid = strtol(argv[2], &end, 10);
    if (errno || *end || raw_pid <= 0 || raw_pid > INT32_MAX) return 2;
    int pid = (int)raw_pid;
    struct rusage_info_v0 usage;
    char path[PROC_PIDPATHINFO_MAXSIZE];
    if (proc_pid_rusage(pid, RUSAGE_INFO_V0, (rusage_info_t *)&usage) != 0 ||
        proc_pidpath(pid, path, sizeof(path)) <= 0 || !usage.ri_proc_start_abstime ||
        usage.ri_proc_exit_abstime) {
      fprintf(stderr, "Cannot observe a live process identity. errno=%d\n", errno);
      return 1;
    }
    printf("{\"pid\":%d,\"birth\":\"%" PRIu64 "\",\"path\":", pid,
           usage.ri_proc_start_abstime);
    json_string(path);
    puts("}");
    return 0;
  }
#endif
  fputs("Use snapshot, calibrate TOKEN, or host process PID.\n", stderr);
  return 2;
}
