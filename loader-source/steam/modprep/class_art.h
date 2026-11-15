/* A second pose shares the same allocated picture ID and uses suffix 01. */
static inline int mp_has_female_pose(unsigned class_id){
    return class_id==97||class_id==126;
}
