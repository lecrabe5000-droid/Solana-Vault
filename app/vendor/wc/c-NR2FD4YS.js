import"./c-DK7ZMNOR.js";import"./c-4L4TA7CY.js";import"./c-HEMO44CV.js";import"./c-AFGKFHDQ.js";import"./c-AD2FH22A.js";import"./c-IQKPNCGW.js";import"./c-LT7ZYH5R.js";import{b as c,e as m,k as a,u as p}from"./c-ONH4HOAO.js";import"./c-ACZNBGDI.js";import"./c-BLX4OB5V.js";import"./c-ZDR73WLG.js";import"./c-NP5TCXNR.js";import"./c-QSH5EGSD.js";import"./c-DBE6YW6D.js";import"./c-LNTXPGOK.js";import"./c-4ERX45K7.js";import"./c-2NN4MGXG.js";var w=c`
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
