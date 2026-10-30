'use strict';
module.exports=function automatic({modelId='sdxl-base',editReady=false,editReason='mask',regenerateReady=true}={}){
  return {version:1,generationStyle:null,target:{visibleCandidateId:'candidate-F',sourceCandidateId:'candidate-F',sourceRevision:'rev',maskReady:editReady},
    generation:{ready:true,settings:{model_id:modelId,negative:'user negative',seed:42,width:832,height:1216,steps:19,cfg:7.5,sampler:'euler_ancestral',scheduler:'simple',cache:false,preview:false}},
    edit:{ready:editReady,feather:4,...(editReady?{}:{reason:editReason}),regenerate:regenerateReady?{ready:true,settings:{model_id:'sdxl-inpaint-v01',seed:31,steps:23,cfg:6.5,denoise:.75,sampler:'euler',scheduler:'normal',roi:false,halo:32,cache:false,preview:false}}:{ready:false,settings:null,reason:'model'}}};
};
