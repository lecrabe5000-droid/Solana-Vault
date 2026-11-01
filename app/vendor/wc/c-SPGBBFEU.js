import"./c-NWBCZPZG.js";import"./c-6ECYCK4P.js";import"./c-WTN44PCZ.js";import"./c-AFGKFHDQ.js";import"./c-BOAU2FWU.js";import"./c-S346Y6CM.js";import"./c-OE5LUIYN.js";import{b as c,e as m,k as a,u as p}from"./c-MO2YK67C.js";import"./c-35RYKUPD.js";import"./c-BLX4OB5V.js";import"./c-UPQBMDEL.js";import"./c-FUBYQF7Y.js";import"./c-N56IQ4RD.js";import"./c-DBE6YW6D.js";import"./c-BZ4Q6P4I.js";import"./c-4ERX45K7.js";import"./c-WVX3PNMJ.js";var w=c`
  :host > wui-flex:first-child {
    height: 500px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
  }

  :host > wui-flex:first-child::-webkit-scrollbar {
    display: none;
  }
`;var u=function(o,e,i,r){var l=arguments.length,t=l<3?e:r===null?r=Object.getOwnPropertyDescriptor(e,i):r,n;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")t=Reflect.decorate(o,e,i,r);else for(var f=o.length-1;f>=0;f--)(n=o[f])&&(t=(l<3?n(t):l>3?n(e,i,t):n(e,i))||t);return l>3&&t&&Object.defineProperty(e,i,t),t},s=class extends a{render(){return m`
      <wui-flex flexDirection="column" .padding=${["0","3","3","3"]} gap="3">
        <w3m-activity-list page="activity"></w3m-activity-list>
      </wui-flex>
    `}};s.styles=w;s=u([p("w3m-transactions-view")],s);export{s as W3mTransactionsView};
