import assert from 'node:assert/strict';
import {evaluateVerification} from '../api/vision.js';

function base(overrides={}){
  return {
    samePlace:true,
    confidence:91,
    target:{state:'MATCH',confidence:88},
    spatialRelations:{state:'MATCH',confidence:84},
    landmarks:[
      {label:'Budynek',stable:true,state:'MATCH',confidence:82},
      {label:'Ścieżka',stable:true,state:'MATCH',confidence:90},
      {label:'Krzewy',stable:false,state:'NOT_VISIBLE',confidence:40}
    ],
    ...overrides
  };
}

assert.equal(evaluateVerification(base()).verified,true,'target + 2 stable landmarks + relations should verify');

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

assert.equal(evaluateVerification(base({target:{state:'NOT_VISIBLE',confidence:75}})).verified,false,'target must be matched');
assert.equal(evaluateVerification(base({spatialRelations:{state:'MISMATCH',confidence:86}})).verified,false,'spatial relations must match');
assert.equal(evaluateVerification(base({confidence:80})).verified,false,'visual confidence below 85 must not verify');

console.log('vision-gate tests: OK');
