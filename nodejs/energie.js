/*
 * Energy stats service 
 * - P1 to JSON service script
 * - Optional Solar panels (Enphase / Enlighten)
 * Edit vars below for your configuration.
 *
 * This script provides 3 services:
 * http://localhost/energy : JSON with actual readout of smart energy meter including derived information (sums, deltas etc)
 * http://localhost/production: JSON with enphase microverter solar panel production (totals/panels). If needed disable this with ENPHASE=false
 * http://localhost/history : JSON with 24 hrs historic values for analyses (day and hour totals) 
 *
 * Since the webservice answers in a JSON some variables are in dutch. Good luck translating ;-)
 * As you might see, there's unused code, that means future plans.
 * 
 * V1.2 - Cleaned code. Made enphase setup optional
 * V1.1 - Added Enphase Solor system
 * V1.0 - Several Sums of items
 * V0.9 - Added improved start/stop behaviour & logging
 * V0.8 - Basic setup for reading P1 Smart Meter/webservice
 */

//libraries
const serial = require('serialport');
const moment = require('moment');
const http = require('http');
const url = require('url');
const fetch = require('node-fetch');
const digestFetch = require('digest-fetch');

//configuration
const DEBUG=false; //log debug info
const P1_USB='/dev/ttyUSB_POWER';//name of P1 USB port
const PORT = 3001;//port for webservices
const ENPHASE=false;//enable enphase solor readings
const URL_INVERTERS = "http://envoy/api/v1/production/inverters";//url for enphase inverter info
const URL_PRODUCTION = 'http://envoy/api/v1/production';//url for enphase production info
const digestClient = new digestFetch('installer', 'put-your-password-here') ;//your password for local enphase api

//safe exit script
var enphaseTimer=-1;
process.on('SIGINT', function() {
  if (enphaseTimer!=-1){
    //timer is running, abort it
    clearInterval(enphaseTimer);
  }
  log("Nodejs stopped");
  process.exit();
});

//P1 data storage (also result for '/energie' service)
var energyIndex = 0;//current active item
var energySize=6*10;//10 minutes cache
var energy=[];
for (let i=0;i<energySize;i++){
  energy[i]={
    stand:{},
    verbruik:{},
    levering:{},
    netto:{},
    delta:{
      verbruik:{},
      levering:{},
      netto:{}
    }
  };
}

//historic storage/cache (also result for '/historie' service)
var today=-1;//current day,\-1 will reset
var todayHour=-1;//current hour,\-1 will reset
var historic={
  dag:{},
  uur:[]
}
for (let i=0;i<24;i++){
  historic.uur[i]={}
}

//fetch http settings
const settings = { method: "Get" };

//solar data storage
var productionActive=true;
var production={
  total:{
    wattsNow:0,
    wattsToday:0
  },
  inverters:[]
};


/*
* ########## Smart meter P1 Serial ##############
*/

//Config for P1 Serial port
var serialPort = new serial(P1_USB, {
    baudRate: 115200,
    databits: 8,
    parity: 'none',
    stopbits: 1
});

//open serial port
serialPort.on('open', function() {
  log('Opened P1 port');

  //init
  var message = '';

  //read chunks of data from serial
  serialPort.on('data', function(buffer) {
    
    //add chunk to message
    message += buffer;

    //check message, first line should contain a '/' and last line a '!'. Usually caused on startup of script
    if (message.indexOf('/')<0) {
      //first line missing, Incomplete
      debug('imcomplete message erased');
      message="";
    } else if (message.indexOf('/')<0 &&  message.indexOf('!')>=0 ){
      //first line missing and last line present. Incomplete
      debug('imcomplete message erased');
      message="";
    } else if (message.indexOf('/') >= 0 && message.indexOf('!') >= 0) {
      //we got starting line and ending line so message complete
      debug('message complete');


      var data = buffer.toString();

      //result is a cached JSON to prevent incomplete results (webservice is called when P1 message is read). And to calculate deltas.
      var oldJson = energy[energyIndex];
      var newIndex = (energyIndex + 1) % energySize;
      var json = energy[newIndex];
      var read=0;

      //init JSON
      json.timestamp = moment().unix();
      json.index=newIndex;
      debug("reading block " + newIndex);
      
      //split input in lines and iterate
      var lines = message.split('\n');
      lines.forEach(function(line, i) {
        
        if (line.length > 4 && line.charAt(3) == ':') {
          //valid value in format '1-0:1.8.1(000051.775*kWh)', get type and value
          var energyType = getStringBetween(line, ':', '(');
          var energyValue = convertToIntegerValue(getStringBetween(line, '(', '*'));
          switch (energyType) {
            case '1.8.1':
              json.stand.verbruikLaag = energyValue;
              read++;
              break;
            case '1.8.2':
              json.stand.verbruikHoog = energyValue;
              read++;
              break;
            case '2.8.1':
              json.stand.leveringLaag = energyValue;
              read++;
              break;
            case '2.8.2':
              json.stand.leveringHoog = energyValue;
              read++;
              break;
            case '96.14.0':
              json.tarief = (energyValue == 1 ? 'laag' : 'hoog');
              read++;
              break;
            case '1.7.0':
              json.verbruik.totaal = energyValue;
              read++;
              break;
            case '2.7.0':
              json.levering.totaal = energyValue;
              read++;
              break;
            case '21.7.0':
              json.verbruik.L1 = energyValue;
              read++;
              break;
            case '41.7.0':
              json.verbruik.L2 = energyValue;
              read++;
              break;
            case '61.7.0':
              json.verbruik.L3 = energyValue;
              read++;
              break;
            case '22.7.0':
              json.levering.L1 = energyValue;
              read++;
              break;
            case '42.7.0':
              json.levering.L2 = energyValue;
              read++;
              break;
            case '62.7.0':
              json.levering.L3 = energyValue;
              read++;
              break;
            default:
            // unknown energy type
            debug('unknown: ' + line);
          }

        }


      });
      
      //all lines in message read, delete processed message (part before end ('!') line)
      var p=message.indexOf('!');
      if (p>=0){
          //! found, so check for end of line
          let p1=message.indexOf('\n',p);
          if (p1>=0){
              //delete complete last line
              message=message.substring(p1+1);
          } else {
              //also delete (this means first line will have some garbage but that's not used anyway)
              message=message.substring(p+1);
          }
      }
      
      //number of vars read from message
      json.read=read;
      
      //calculate derived values
      if (json.tarief='laag'){
        json.verbruikLaag=json.verbruik.totaal;
        json.verbruikHoog=0;
        json.leveringLaag=json.levering.totaal;
        json.leveringHoog=0;
      } else {
        json.verbruikLaag=0;
        json.verbruikHoog=json.verbruik.totaal;
        json.leveringLaag=0;
        json.leveringHoog=json.levering.totaal;
      }
      
      //calculate sums
      json.netto.totaal=json.verbruik.totaal-json.levering.totaal;
      json.netto.L1L2L3=json.verbruik.L1+json.verbruik.L2+json.verbruik.L3-json.levering.L1-json.levering.L2-json.levering.L3;
      json.netto.L1=json.verbruik.L1-json.levering.L1;
      json.netto.L2=json.verbruik.L2-json.levering.L2;
      json.netto.L3=json.verbruik.L3-json.levering.L3;

      //build history
      
      var check=new Date();
      if (check.getDate()!=today){
        //new day, reset running totals to 0
        today=check.getDate();
        historic.dag.dag=today;
        historic.dag.productie=0;
        historic.dag.levering=0;
        historic.dag.verbruik=0;
        historic.dag.verbruikLaag=0;
        historic.dag.verbruikHoog=0;
        historic.dag.leveringLaag=0;
        historic.dag.leveringHoog=0;
        
      }
      if (check.getHours()!=todayHour){
        //new hour, reset running totals to 0
        todayHour=check.getHours();
        historic.uur[todayHour].dag=today;
        historic.uur[todayHour].uur=todayHour;
        historic.uur[todayHour].productie=0;
        historic.uur[todayHour].levering=0;
        historic.uur[todayHour].verbruik=0;
        historic.uur[todayHour].verbruikLaag=0;
        historic.uur[todayHour].verbruikHoog=0;
        historic.uur[todayHour].leveringLaag=0;
        historic.uur[todayHour].leveringHoog=0;
      }
    
      //add current values to history/running totals. Remember 1000W / 10 seconds = 1000W / 360 for 1 hour!
      historic.dag.verbruik+=json.verbruik.totaal/360;
      historic.dag.levering+=json.levering.totaal/360;
      historic.dag.verbruikLaag+=json.verbruikLaag/360;
      historic.dag.verbruikHoog+=json.verbruikHoog/360;
      historic.dag.leveringLaag+=json.leveringLaag/360;
      historic.dag.leveringHoog+=json.leveringHoog/360;
      
      historic.uur[todayHour].verbruik+=json.verbruik.totaal/360;
      historic.uur[todayHour].levering+=json.levering.totaal/360;
      historic.uur[todayHour].verbruikLaag+=json.verbruikLaag/360;
      historic.uur[todayHour].verbruikHoog+=json.verbruikHoog/360;
      historic.uur[todayHour].leveringLaag+=json.leveringLaag/360;
      historic.uur[todayHour].leveringHoog+=json.leveringHoog/360;
      

      //if we got valid previous data calculate deltas. 
      if (oldJson.hasOwnProperty('verbruik')){

        if (!json.delta){
            json.delta={};
        }

        json.delta.verbruik.totaal=json.verbruik.totaal-oldJson.verbruik.totaal;
        json.delta.levering.totaal=json.levering.totaal-oldJson.levering.totaal;
        json.delta.netto.totaal=json.netto.totaal-oldJson.netto.totaal;

        json.delta.verbruik.L1=json.verbruik.L1-oldJson.verbruik.L1;
        json.delta.verbruik.L2=json.verbruik.L2-oldJson.verbruik.L2;
        json.delta.verbruik.L3=json.verbruik.L3-oldJson.verbruik.L3;

        json.delta.levering.L1=json.levering.L1-oldJson.levering.L1;
        json.delta.levering.L2=json.levering.L2-oldJson.levering.L2;
        json.delta.levering.L3=json.levering.L3-oldJson.levering.L3;

        json.delta.netto.L1=json.netto.L1-oldJson.netto.L1;
        json.delta.netto.L2=json.netto.L3-oldJson.netto.L2;
        json.delta.netto.L3=json.netto.L3-oldJson.netto.L3;
      }
      
      //copy solar panel production
      if (ENPHASE){
        json.productie={};
        json.productie.now=production.total.wattsNow;
        json.productie.today=production.total.wattsToday;
      }else {
        json.productie.now=0;
        json.productie.today=0;
      }

      //results
      debug(json);

      //data complete, switch bank to new one (this is what webservice returns)
      energyIndex=newIndex;


    }
  });

});

serialPort.on('error', function(data) {
    log('@' + moment().format() + ": Error reading p1 port: " + data);
});




/*
* ###### WEBSERVER ##########
*/

//webserver init

//init webserver
const server = http.createServer((req, res) => {
  
    //data for request
    let data = '';

    //read data chunk by chunk
    req.on('data', chunk => {
        data += chunk;
    });

    //on completion
    req.on('end', () => {

        //get url and query
        let myUrl = url.parse(req.url,true);
        let path = lcase(myUrl.pathname);
        let query = myUrl.query;
        let bookmark = lcase(myUrl.hash);

        //split path in /command/parameter/value/ignore/ ...
        let command="";
        let parameter="";
        let value="";
        let i=path.indexOf('/',1);
        if (i<0){
            command=path;
        }else {
            let j=path.indexOf('/',i+1);
            command=path.substring(0,i);
            if (j<0){
                command=path.substring(0,i);
                parameter=path.substring(i+1);
            } else {
                parameter=path.substring(i+1,j);
                i=path.indexOf('/',j+1);
                if (i<0){
                    value=path.substring(j+1);
                } else {
                    value=path.substring(j+1,i);
                }
            }
        }
        
        //standard value/number
        value=value.toUpperCase();
        let parameterNr=parseInt(parameter);
        if (isNaN(parameterNr)){
            parameterNr=-1;
        }

        //check for json input
        let json={};
        try {
            json = JSON.parse(data);
        } catch (e){
        }

        //debug info
        debug('------------');
        debug(path);
        debug(command);
        debug(parameter);
        debug(value);
        debug(query);
        debug(bookmark);
        debug(data);
        debug(json);

        //default response
        let response="";
        
        //answer request (so far simple approach that doesn't use previous interpretation 

        if (path=='/energy'){
          //energy meter service 
          response=JSON.stringify(energy[energyIndex]);
        } else if (path=='/production'){
          //solar panel production service
            response=JSON.stringify(production);
        } else if (path=='/history'){
          //historic values
           response=JSON.stringify(historic);
        }

        //respond to request
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
        res.end(response);
        debug('response '+response);


   // res.end();
  });

});

//start server on given port
server.listen(PORT, () => {
  log(`Server running on port ${PORT}.`);
});



/*
###############3 Enphase solar panels ###############
*/

if (ENPHASE){
  //update solor panel production every 5 minutes (=300.000 millsec)
  getEnphaseProduction();
  enphaseTimer = setInterval(getEnphaseProduction,300000);
  debug('enphase reading on');
}

//read local enphase solar panel production from envoy webservice
function getEnphaseProduction(){

  fetch(URL_PRODUCTION, settings)
    .then(res => res.json())
    .then((json) => {
      //process incoming json response
      
      //sometimes at end of day last value wattsNow keeps hanging for a few periods, correct this
      let wattsNow=0;
      let wattsToday=json.wattHoursToday;      
      if (json.wattsNow>100 || (json.wattsNow>=0 && productionActive))  {
        //valid result, either more than 100 Watt or at least one inverter gives actual data
        wattsNow=json.wattsNow;
      }
      
      production.total.wattsNow=wattsNow;
      production.total.wattsToday=wattsToday;
              
      //timer on 5 minutes, so 120 watt/5 minutes = 120/12 Watt/hour
      historic.dag.productie+=wattsNow/12;
      if (todayHour>=0){
        //init done
        historic.uur[todayHour].productie+=wattsNow/12;
      }

    });

  digestClient.fetch(URL_INVERTERS, settings)
    .then(resp=>resp.json())
    .then(data=>{
      //proces incoming json inverter data
      
      //now - 15 minutes
      let old=new Date();
      old=new Date(old.getTime()-15*60000);
      
      //check at least 1 is alive
      let on=false;
      
      //clear inverters
      production.inverters=[];
      for (let i=0;i<data.length;i++){
        //get report time of microinverter
        var d=new Date(data[i].lastReportDate*1000);
        if (d.getTime()>old.getTime()){
          //actual data
          production.inverters.push({nr:(i+1),watt:data[i].lastReportWatts,maxWatt:data[i].maxReportWatts});
          on=true;
        }else {
          //old data, so power to low to update. Use 0 Watt
          production.inverters.push({nr:(i+1),watt:0,maxWatt:data[i].maxReportWatts});
        }
      };
      
      productionActive=on;
      
      debug(production);
    })
    .catch(e=>log(e));
}



/*
##### helper functions ############3
*/


//gets the string between to chars
function getStringBetween(data, charLeft, charRight) {
    var i = data.indexOf(charLeft);
    if (i < 0) {
        i = 0;
    } else {
        i++;
    }
    var j = data.indexOf(charRight);
    if (j < 0) {
        j = data.length;
    }

    var result = data.substring(i, j);
    if (result.endsWith(')')) {
        result = result.substring(0, result.length - 1);
    }


    return result;
}

//converts string number to number (10.123  => 10123 instead of rounded 10)
function convertToIntegerValue(value) {
    return parseInt(value.replace(/\./, ''), 10);
}

//null safe lcase
function lcase(x) {
  if (x == null){
      return "";
  } else {
      return x.toLowerCase();
  }
}

//log (always)
function log(msg){
  console.log(msg);
}

//log debug info when on
function debug(msg){
  if (DEBUG){
      console.debug(msg);
  }
}
