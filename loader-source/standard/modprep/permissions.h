#ifndef TOR_MODPREP_PERMISSIONS_H
#define TOR_MODPREP_PERMISSIONS_H
#include <stdint.h>
#include <stddef.h>

/* Portable data-reader component. No injection, patching or game hooks here.
   Caller owns immutable storage and must separately verify the expected project
   and allocation digests (bytes 48..79 and 80..111). Query validates all indices.
   Only use a view after mp_permissions_open succeeds. */
typedef struct MP_Permissions {
    const uint8_t *data;
    uint32_t groups,classes,templates,stride,matrix,assign;
} MP_Permissions;

int mp_permissions_open(MP_Permissions *out,const void *data,size_t size);
int mp_permissions_group(const MP_Permissions *view,uint32_t template_id,uint32_t *group);
int mp_permissions_allows(const MP_Permissions *view,uint32_t template_id,uint32_t class_id,int *allowed);
#endif
