import assert from 'node:assert/strict';
import {evaluateVerification} from '../api/vision.js';

function base(overrides={}){
  return {
    samePlace:true,
    confidence:91,
    target:{
      state:'MATCH',
      confidence:88,
      label:'Target',
      kind:'OTHER',
      anchorType:'OTHER',
      surface:'UNKNOWN',
      touchesObject:false,
      groundContactPoint:false,
      markerOnAdjacentFlatSurface:false,
      occludedByVegetation:false,
      evidence:''
    },
    spatialRelations:{state:'MATCH',confidence:84},
    landmarks:[
      {label:'Budynek',stable:true,state:'MATCH',confidence:82},
      {label:'Ścieżka',stable:true,state:'MATCH',confidence:90},
      {label:'Krzewy',stable:false,state:'NOT_VISIBLE',confidence:40}
    ],
    ...overrides
  };
}

function poleTarget(overrides={}){
  return {
    state:'MATCH',
    confidence:90,
    label:'Punkt zakotwiczenia słupa',
    kind:'POLE_BASE',
    anchorType:'GROUND_CONTACT_POINT',
    surface:'GRASS',
    touchesObject:true,
    groundContactPoint:true,
    markerOnAdjacentFlatSurface:false,
    occludedByVegetation:false,
    evidence:'Oś słupa dochodzi do styku z trawą.',
    ...overrides
  };
}

assert.equal(evaluateVerification(base()).verified,true,'generic target + 2 stable landmarks + relations should verify');

assert.equal(evaluateVerification(base({
  landmarks:[
    {label:'Budynek',stable:true,state:'NOT_VISIBLE',confidence:70},
    {label:'Ścieżka',stable:true,state:'MATCH',confidence:90},
    {label:'Słup',stable:true,state:'MATCH',confidence:85}
  ]
})).verified,true,'NOT_VISIBLE must not act as a mismatch');

assert.equal(evaluateVerification(base({
  landmarks:[
    {label:'Budynek',stable:true,state:'MISMATCH',confidence:91},
    {label:'Ścieżka',stable:true,state:'MATCH',confidence:90},
    {label:'Słup',stable:true,state:'MATCH',confidence:85}
  ]
})).verified,false,'high-confidence stable mismatch must veto verification');

assert.equal(evaluateVerification(base({target:{...base().target,state:'NOT_VISIBLE',confidence:75}})).verified,false,'target must be matched');
assert.equal(evaluateVerification(base({spatialRelations:{state:'MISMATCH',confidence:86}})).verified,false,'spatial relations must match');
assert.equal(evaluateVerification(base({confidence:80})).verified,false,'visual confidence below 85 must not verify');

assert.equal(evaluateVerification(base({target:poleTarget()})).verified,true,'pole base verifies only at real ground contact point');

const asphaltBesidePole=evaluateVerification(base({
  target:poleTarget({surface:'ASPHALT',touchesObject:false,groundContactPoint:false,markerOnAdjacentFlatSurface:true})
}));
assert.equal(asphaltBesidePole.verified,false,'marker on asphalt beside pole must never verify');
assert.equal(asphaltBesidePole.targetAnchorValid,false,'adjacent-flat-surface marker must fail anchor gate');

const notAtContact=evaluateVerification(base({
  target:poleTarget({anchorType:'SURFACE_POINT',groundContactPoint:false})
}));
assert.equal(notAtContact.verified,false,'pole marker away from ground contact must not verify');
assert.equal(notAtContact.targetAnchorRequired,true,'pole-base target must require anchor validation');

const poleInAsphalt=evaluateVerification(base({
  target:poleTarget({surface:'ASPHALT',touchesObject:true,groundContactPoint:true,markerOnAdjacentFlatSurface:false})
}));
assert.equal(poleInAsphalt.verified,true,'a pole genuinely anchored in asphalt may verify if marker touches the pole at ground contact');

console.log('vision-gate tests: OK');
