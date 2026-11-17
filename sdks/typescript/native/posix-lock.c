#define _GNU_SOURCE
#define NAPI_VERSION 8
#include <node_api.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <string.h>

#ifndef F_OFD_SETLK
#error "Open file description record locks are required"
#endif

static napi_value failure(napi_env env) {
  napi_throw_error(env, NULL, "Journal OS lock unavailable");
  return NULL;
}

static int descriptor(napi_env env, napi_callback_info info, int *fd) {
  size_t argc = 1;
  napi_value argv[1];
  double value;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1 ||
      napi_get_value_double(env, argv[0], &value) != napi_ok ||
      !(value >= 0 && value <= INT_MAX) || value != (int)value) return 0;
  *fd = (int)value;
  return 1;
}

static int record_lock(int fd, short type) {
  struct flock lock;
  memset(&lock, 0, sizeof(lock));
  lock.l_type = type;
  lock.l_whence = SEEK_SET;
  // l_start=0, l_len=0: the entire file, including future growth. l_pid must be 0.
  return fcntl(fd, F_OFD_SETLK, &lock);
}

static napi_value try_lock(napi_env env, napi_callback_info info) {
  int fd;
  if (!descriptor(env, info, &fd)) return failure(env);
  int result = record_lock(fd, F_WRLCK);
  if (result < 0 && errno != EAGAIN && errno != EACCES && errno != EINTR) return failure(env);
  napi_value value;
  if (napi_get_boolean(env, result == 0, &value) != napi_ok) return failure(env);
  return value;
}

static napi_value unlock(napi_env env, napi_callback_info info) {
  int fd, result;
  if (!descriptor(env, info, &fd)) return failure(env);
  do { result = record_lock(fd, F_UNLCK); } while (result < 0 && errno == EINTR);
  if (result < 0) return failure(env);
  napi_value value;
  if (napi_get_undefined(env, &value) != napi_ok) return failure(env);
  return value;
}

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
    {"tryLock", NULL, try_lock, NULL, NULL, NULL, napi_default, NULL},
    {"unlock", NULL, unlock, NULL, NULL, NULL, napi_default, NULL}
  };
  if (napi_define_properties(env, exports, 2, properties) != napi_ok) return failure(env);
  return exports;
}
