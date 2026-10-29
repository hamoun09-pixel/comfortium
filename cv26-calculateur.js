(function(){'use strict';
let data=[],chosen=null;
const $=id=>document.getElementById(id),locale=()=>document.documentElement.lang==='en';
const t=(fr,en)=>locale()?en:fr;
const amount=n=>new Intl.NumberFormat(locale()?'en-CA':'fr-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(n);
function resetSelect(el,placeholder){el.replaceChildren(new Option(placeholder,''));el.disabled=true;}
function unique(items){return [...new Set(items)].sort((a,b)=>a.localeCompare(b));}
function option(el,label,value){el.add(new Option(label,value));}
function show(){let r=chosen;if(!r)return;const multi=$('cv26Type').value==='multi';const units=+$('cv26Units').value,devices=+$('cv26Devices').value;
 $('cv26MultiFields').classList.toggle('cv26-hidden',!multi);
 const box=$('cv26Preview');box.classList.remove('cv26-hidden');box.replaceChildren();
 const add=(label,val)=>{let p=document.createElement('p');let strong=document.createElement('strong');strong.textContent=label+' : ';p.append(strong,document.createTextNode(String(val)));box.append(p);};
 add(t('Marque','Brand'),r.brand);add(t('Appareil extérieur','Outdoor unit'),r.out);add(t('Appareil intérieur','Indoor unit'),r.inside||'—');if(r.furnace)add(t('Fournaise','Furnace'),r.furnace);
 add('AHRI',r.ahri||'—');add('ENERGY STAR',r.energy||'—');add(t('Puissance nominale','Nominal capacity'),r.btu);add(t('Subvention LogisVert de ce modèle','LogisVert rebate for this model'),r.base?amount(r.base):t('À évaluer','To be assessed'));
 if(multi){add(t('Bonus multilogement possible','Possible multi-unit bonus'),r.multi?'+ '+amount(r.multi)+t(' si l’immeuble répond aux critères d’Hydro-Québec',' if the building meets Hydro-Québec’s criteria'):t('À confirmer avec Hydro-Québec','To be confirmed with Hydro-Québec'));add(t('Logements déclarés','Declared units'),Number.isInteger(units)&&units>=2?units:t('À préciser','To confirm'));add(t('Appareils envisagés','Planned units'),Number.isInteger(devices)&&devices>=1?devices:t('À préciser','To confirm'));}
 let note=document.createElement('p');note.className='cv26-help';note.textContent=t('Montant selon la grille d’Hydro-Québec (120 $ par 1 000 BTU/h à −8 °C pour un modèle climat froid), versé après l’installation, sous réserve d’admissibilité. Vos économies sont calculées dans l’étude de consommation, à la fin du questionnaire.','Amount based on Hydro-Québec’s grid ($120 per 1,000 BTU/h at −8 °C for a cold-climate model), paid after installation, subject to eligibility. Your savings are calculated in the energy use study at the end of the questionnaire.');box.append(note);
 window.cv26Selected=r;window.cv26Project={type:multi?'multi':'res',units,devices};try{if(typeof window.onCv26Change==='function')window.onCv26Change();}catch(e){console.error(e);}
}
async function init(){const status=$('cv26Status');try{const embedded=$('cv26EmbeddedCatalogue');if(embedded){data=JSON.parse(embedded.textContent);}else{let response=await fetch('catalogue-comfortium-2026-10-15.json');if(!response.ok)throw Error('HTTP '+response.status);data=await response.json();}const b=$('cv26Brand');unique(data.map(x=>x.brand)).forEach(x=>option(b,x,x));status.textContent=t('Catalogue chargé : ','Catalogue loaded: ')+data.length+t(' configurations pour 14 marques.',' configurations across 14 brands.');}catch(e){status.textContent=t('Catalogue indisponible. Veuillez réessayer ou contacter Comfortium.','Catalogue unavailable. Please retry or contact Comfortium.');console.error(e);}}
function chooseMatch(row){
 const brand=$('cv26Brand'),out=$('cv26Out'),config=$('cv26Config');
 brand.value=row.brand;
 brand.dispatchEvent(new Event('change'));
 out.value=row.out;
 out.dispatchEvent(new Event('change'));
 const index=(window.cv26Choices||[]).findIndex(x=>x===row || (x.ahri===row.ahri&&x.energy===row.energy&&x.out===row.out&&x.inside===row.inside&&x.furnace===row.furnace));
 if(index>=0){config.value=String(index);config.dispatchEvent(new Event('change'));}
}
const normalize=x=>String(x||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
$('cv26Search').addEventListener('input',()=>{
 const q=normalize($('cv26Search').value),panel=$('cv26SearchResults'),select=$('cv26Matches'),info=$('cv26SearchInfo');
 select.replaceChildren(new Option(t('— Choisir une configuration —','— Select a configuration —'),''));
 if(q.length<3){panel.classList.add('cv26-hidden');info.textContent=t('Saisissez au moins 3 caractères pour rechercher.','Enter at least 3 characters to search.');return;}
 const matches=data.map((r,i)=>({r,i})).filter(({r})=>[r.out,r.inside,r.furnace,r.ahri,r.energy].some(v=>normalize(v).includes(q)));
 window.cv26Matches=matches;
 panel.classList.toggle('cv26-hidden',!matches.length);
 info.textContent=matches.length?t(matches.length+' configuration(s) trouvée(s).',''+matches.length+' matching configuration(s).'):t('Aucune configuration trouvée. Vérifiez la référence.','No matches. Check the reference.');
 matches.slice(0,150).forEach(({r},i)=>option(select,r.brand+' · '+r.out+' / '+(r.inside||r.furnace||'—')+' · AHRI '+(r.ahri||'—')+' · ENERGY STAR '+(r.energy||'—'),String(i)));
 if(matches.length>150)info.textContent+=t(' Affichage des 150 premiers résultats : précisez la recherche.',' Showing first 150 results: refine your search.');
 if(matches.length===1){select.value='0';chooseMatch(matches[0].r);}
});
$('cv26Matches').addEventListener('change',()=>{const i=$('cv26Matches').value;if(i!=='')chooseMatch(window.cv26Matches[+i].r);});
$('cv26Brand').addEventListener('change',()=>{chosen=null;window.cv26Selected=null;resetSelect($('cv26Out'),'— Choisir —');resetSelect($('cv26Config'),'— Choisir —');$('cv26Preview').classList.add('cv26-hidden');$('cv26Continue').disabled=true;const subset=data.filter(x=>x.brand===$('cv26Brand').value);if(subset.length){unique(subset.map(x=>x.out).filter(Boolean)).forEach(x=>option($('cv26Out'),x,x));$('cv26Out').disabled=false;}});
$('cv26Out').addEventListener('change',()=>{chosen=null;window.cv26Selected=null;resetSelect($('cv26Config'),'— Choisir —');$('cv26Preview').classList.add('cv26-hidden');$('cv26Continue').disabled=true;const subset=data.filter(x=>x.brand===$('cv26Brand').value&&x.out===$('cv26Out').value);subset.forEach((x,i)=>option($('cv26Config'),(x.inside||'—')+(x.furnace?' / '+x.furnace:'')+' · AHRI '+(x.ahri||'—'),String(i)));$('cv26Config').disabled=!subset.length;window.cv26Choices=subset;});
$('cv26Config').addEventListener('change',()=>{const v=$('cv26Config').value;chosen=v===''?null:window.cv26Choices[+v];$('cv26Continue').disabled=!chosen;if(chosen)show();else $('cv26Preview').classList.add('cv26-hidden');});
$('cv26Type').addEventListener('change',()=>{ $('cv26MultiFields').classList.toggle('cv26-hidden',$('cv26Type').value!=='multi');if(chosen)show();});
['cv26Units','cv26Devices'].forEach(id=>$(id).addEventListener('input',()=>{if(chosen)show();}));
$('cv26Continue').addEventListener('click',()=>{if(!chosen)return;document.getElementById('calcSection').scrollIntoView({behavior:'smooth'});});
init();
})();