// Native particle integration (500ABF–500C35). Y is world-up. The game
// uses tenths for mass/drag and applies gravity after the force division.
export function advanceParticle(position,velocity,acceleration,jerk,inertia,drag,gravity){
  for(let k=0;k<3;k++){
    velocity[k]=inertia?((inertia-drag)*0.1*velocity[k]+acceleration[k])/(inertia*0.1):acceleration[k];
    if(k===1)velocity[k]-=gravity*0.1;
    position[k]+=velocity[k];
    acceleration[k]+=jerk[k];
  }
}
