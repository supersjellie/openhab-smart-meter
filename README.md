# smart_meter (P1 interface)

## Summary
NodeJS script for a (dutch) smart meter with P1 connection. It read's the telegrams over the P1 serial (USB cable connection) and makes the results available over a JSON webservices. It contains both raw actual values, history and derived values like sums and delta's. Optionally you can activate an integration with envoy/enlighten solar panels. Optional you could use the included openHAB configuration.

Features
1. http://hostname/energy 
	* Smart meter readings in JSON format of usage, production both actual as aggregated and delta's
2. http://hostname/history
	* Historical values of smart meter in JSON format with day and hour-by-hour totals.
3. http://hostname/production 
	* (optional when activated) production of envoy/enlighten solar panel system with totals and seperate inverter/panel data
## Worklist
Using the [releases](https://github.com/Supersjellie/smart_meter/releases) in github now
Using the [issues](https://github.com/Supersjellie/smart_meter/issues) in github now
(I'm not using branches for work in progress (i.e. latest milestone), so download a release for a stable version)

## Preperation
1. Have an openhab installation :grin:
2. Own a smart meter with P1 port and USB-cable to connect :grin:
3. Adapt configuration to your needs (top of NodeJS code). Important either use ENPHASE=false OR put in your password!
4. Install in openhab the http binding, see [documentation](https://www.openhab.org/addons/bindings/http/)
6. Install in openhab the jsonpath transformation, see [documentation](https://www.openhab.org/addons/transformations/jsonpath/)
7. Install in openHAB the javascript scriping engine, see [documentation](https://www.openhab.org/addons/automation/jsscripting/)

## Create thing
1. Create a new thing
2. Choose the HTTP binding
3. Don't use GUI but move to tab code
4. Copy and paste the yaml in the thing folder of this project
5. Save the thing 
6. Don't close it

## Create equipment
1. If it's closed, navigate to your smart_meter thing
2. Move to the tab 'channels'
3. Use button 'Add equipment to model
4. Select all channels and add-on
5. Openhab will create/add equipment and items

## Widget installation
1. TODO (but you can use one of the standard openHAB widgets)

## Versions
* V1.2 - Cleaned code. Made enphase setup optional
* V1.1 - Added Enphase Solor system
* V1.0 - Several Sums of items
* V0.9 - Added improved start/stop behaviour & logging
* V0.8 - Basic setup for reading P1 Smart Meter/webservice
	
## Code
The code is pretty standard if you're familair with nodeJS. Know that I have plans, that's why some code had no use at this moment.