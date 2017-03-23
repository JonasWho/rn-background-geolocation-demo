'use strict';

import React, { Component } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Switch,
  AppState
 } from 'react-native';

import EventEmitter from 'EventEmitter';

import Icon from 'react-native-vector-icons/Ionicons';
import MapView from 'react-native-maps';
import Modal from 'react-native-modalbox';
import ActionButton from 'react-native-action-button';
import Button from 'apsl-react-native-button'
import Spinner from 'react-native-spinkit';

import Config from './config';
import commonStyles from './styles';
import BottomToolbarView from './BottomToolbarView';
import SettingsService from './SettingsService';
import GeofenceView from './GeofenceView';
import SettingsView from './SettingsView';
import BGService from './BGService';

var MAP_MARKER_IMAGE = require('../images/location_marker.png');

const LATITUDE_DELTA = 0.00922;
const LONGITUDE_DELTA = 0.00421;

const STATIONARY_REGION_FILL_COLOR = "rgba(200,0,0,0.2)"
const STATIONARY_REGION_STROKE_COLOR = "rgba(200,0,0,0.2)"
const GEOFENCE_STROKE_COLOR = "rgba(17,183,0,0.5)"
const GEOFENCE_FILL_COLOR   ="rgba(17,183,0,0.2)"
const GEOFENCE_STROKE_COLOR_ACTIVATED = "rgba(127,127,127,0.5)";
const GEOFENCE_FILL_COLOR_ACTIVATED = "rgba(127,127,127, 0.2)";
const POLYLINE_STROKE_COLOR = "rgba(32,64,255,0.6)";

let eventEmitter = new EventEmitter();

class HomeView extends React.Component {
  //locationIcon: require("image!green_circle"),

  constructor() {
    super();
    this.bgService = BGService.getInstance();
    this.settingsService = SettingsService.getInstance();

    this.state = {
      isMainMenuOpen: false,
      currentState: AppState.currentState,
      enabled: false,
      title: 'Background Geolocation',
      centerCoordinate: {
        latitude: 0,
        longitude: 0
      },
      // ActionButton state
      isSyncing: false,
      // Map state
      isPressingOnMap: false,
      mapScrollEnabled: false,
      followsUserLocation: true,
      stationaryLocation: {timestamp: '',latitude:0,longitude:0},
      stationaryRadius: 0,
      showsUserLocation: true,
      markers: [],
      geofences: [],
      geofencesHit: [],
      geofencesHitEvents: [],
      coordinates: [],
      settings: {}
    };
  }

  componentDidMount() {
    AppState.addEventListener('change', this.onAppStateChange.bind(this));

    this.setState({
      enabled: false
    });

    // Configure BackgroundGeolocation
    this.bgService.getState((state) => {
      this.configureBackgroundGeolocation(state);
    });

    // Fetch current app settings state.
    this.settingsService.getState((state) => {
      this.setState({
        settings: state 
      });
    });

    this.settingsService.on('change', this.onSettingsChanged.bind(this));
  }

  componentWillUnmount() {
    AppState.removeEventListener('change', this.onAppStateChange.bind(this));
    let bgGeo = this.bgService.getPlugin();

    // Unregister BackgroundGeolocation event-listeners!
    bgGeo.un("location", this.onLocation.bind(this));
    bgGeo.un("http", this.onHttp.bind(this));
    bgGeo.un("geofence", this.onGeofence.bind(this));
    bgGeo.un("heartbeat", this.onHeartbeat.bind(this));
    bgGeo.un("error", this.onError.bind(this));
    bgGeo.un("motionchange", this.onMotionChange.bind(this));
    bgGeo.un("schedule", this.onSchedule.bind(this));
    bgGeo.un("geofenceschange", this.onGeofencesChange.bind(this));
  }

  onAppStateChange(currentAppState) {
    var showsUserLocation = (currentAppState === 'background') ? false : true;

    this.setState({
      currentAppState: currentAppState,
      showsUserLocation: showsUserLocation
    });
  }

  onSettingsChanged(event) {
    switch(event.name) {
      case 'hideMarkers':
        break;
      case 'hidePolyline':
        break;
      case 'showGeofenceHits':
        break;
      case 'followsUserLocation':
        this.setState({followsUserLocation: event.value});
        if (event.value) {
          this.setState({mapScrollEnabled: false});
        }
        break;
    }
    //this.setState({settings: event.state});
  }

  onClickMapMenu(command) {
    this.bgService.playSound('BUTTON_CLICK');

    let enabled = !this.state.settings[command];
    this.settingsService.set(command, enabled);

    let settings = Object.assign({}, this.state.settings);
    settings[command] = enabled;

    this.setState({
      settings: settings
    });
  }

  onClickMainMenu() {
    let soundId = (this.state.isMainMenuOpen) ? 'CLOSE' : 'OPEN';
    this.setState({
      isMainMenuOpen: !this.state.isMainMenuOpen
    });
    this.bgService.playSound(soundId);
  }

  onSelectMainMenu(command) {
    let bgGeo = this.bgService.getPlugin();

    switch(command) {
      case 'settings':
        this.bgService.playSound('OPEN');
        this.settingsView.open();
        break;
      case 'resetOdometer':
        this.bgService.playSound('BUTTON_CLICK');
        this.setState({isResettingOdometer: true, odometer: '0.0'});
        this.bgService.setOdometer(0, () => {
          this.setState({isResettingOdometer: false});
          this.settingsService.toast('Reset odometer success');
        }, (error) => {
          this.setState({isResettingOdometer: false});
          this.settingsService.toast('Reset odometer failure: ' + error);
        });
        break;
      case 'emailLog':
        this.bgService.playSound('BUTTON_CLICK');
        this.settingsService.getState((state) => {
          if (!state.email || !state.email.length) {
            this.settingsService.toast("Please enter an email address in Settings");
            return;
          }
          bgGeo.emailLog(state.email);
        });
        break;
      case 'sync':
        this.bgService.playSound('BUTTON_CLICK');
        bgGeo.getCount((count) => {
          if (!count) {
            this.settingsService.toast('Locations database is empty');
            return;
          }
          this.settingsService.confirm('Confirm Sync', 'Sync ' + count + ' records?', () => {
            this.setState({isSyncing: true});
            bgGeo.sync((rs) => {
              this.settingsService.toast('Sync success (' + count + ' records)');
              this.bgService.playSound('MESSAGE_SENT');
              this.setState({isSyncing: false});
            }, (error) => {
              this.settingsService.toast('Sync error: ' + error);
              this.setState({isSyncing: false});
            });
          });
        });
        break;
      case 'destroyLocations':
        this.bgService.playSound('BUTTON_CLICK');
        bgGeo.getCount((count) => {
          if (!count) {
            this.settingsService.toast('Locations database is empty');
            return;
          }
          this.settingsService.confirm('Confirm Delete', 'Destroy ' + count + ' records?', () => {
            bgGeo.destroyLocations(() => {
              this.settingsService.toast('Destroyed ' + count + ' records');
            }, (error) => {
              this.settingsService.toast('Destroy locations error: ' + error, null, 'LONG');
            });
          });
        });
        break;
    }
  }

  onClickEnable() {
    let enabled = !this.state.enabled;
    var bgGeo = this.bgService.getPlugin();

    if (enabled) {
      bgGeo.start((state) => {
        console.log('- Start success: ', state);
      });
    } else {
      bgGeo.stop(() => {
        console.log('- stopped');
      });

      // Clear markers, polyline, geofences, stationary-region
      this.setState({
        coordinates: [],
        markers: [],
        geofences: [],
        stationaryRadius: 0,
        stationaryLocation: {
          timestamp: '',
          latitude: 0,
          longitude: 0
        },
        geofencesHit: [],
        geofencesHitEvents: []
      });
    }

    this.setState({
      enabled: enabled
    });

    // Transmit to other components
    eventEmitter.emit('enabled', enabled);
  }

  configureBackgroundGeolocation(config) {
    let bgGeo = this.bgService.getPlugin();
    ////
    // 1. Set up listeners on BackgroundGeolocation events
    //
    // location event
    bgGeo.on("location", this.onLocation.bind(this));
    // http event
    bgGeo.on("http", this.onHttp.bind(this));
    // geofence event
    bgGeo.on("geofence", this.onGeofence.bind(this));
    // heartbeat event
    bgGeo.on("heartbeat", this.onHeartbeat.bind(this));
    // error event
    bgGeo.on("error", this.onError.bind(this));
    // motionchange event
    bgGeo.on("motionchange", this.onMotionChange.bind(this));
    // schedule event
    bgGeo.on("schedule", this.onSchedule.bind(this));
    // geofenceschange
    bgGeo.on("geofenceschange", this.onGeofencesChange.bind(this));

    ////
    // 2. Configure it.
    //
    // OPTIONAL:  Optionally generate a test schedule here.
    //  1: how many schedules?
    //  2: delay (minutes) from now to start generating schedules
    //  3: schedule duration (minutes); how long to stay ON.
    //  4: OFF time between (minutes) generated schedule events.
    //
    //  eg:
    //  schedule: [
    //    '1-6 9:00-17:00',
    //    '7 10:00-18:00'
    //  ]
    // UNCOMMENT TO AUTO-GENERATE A SERIES OF SCHEDULE EVENTS BASED UPON CURRENT TIME:
    //config.schedule = SettingsService.generateSchedule(24, 1, 1, 1);
    //
    //config.url = 'http://192.168.11.100:8080/locations';

    bgGeo.configure(config, (state) => {
      console.log('- configure success.  Current state: ', state);

      // Broadcast to child components.
      eventEmitter.emit('enabled', state.enabled);

      // Start the scheduler if configured with one.
      if (state.schedule.length) {
        bgGeo.startSchedule(function() {
          console.info('- Scheduler started');
        });
      }

      // Update UI
      this.setState({
        enabled: state.enabled
      });
    });
  }

  onError(error) {
    console.log('- ERROR: ', JSON.stringify(error));
  }

  onMotionChange(event) {
    var location = event.location;
    console.log("- motionchange", JSON.stringify(event));
    if (event.isMoving) {
      this.setState({
        stationaryRadius: 0,
        stationaryLocation: {
          timestamp: '',
          latitude: 0,
          longitude: 0
        }
      });
    } else {
      this.setState({
        stationaryRadius: 200,
        stationaryLocation: {
          timestamp: event.location.timestamp,
          latitude: event.location.coords.latitude,
          longitude: event.location.coords.longitude
        }
      })
    }
  }

  onLocation(location) {
    console.log('- location: ', JSON.stringify(location));
    if (!location.sample) {
      this.addMarker(location);
    }
    // Seems to fix PolyLine rendering issue by wrapping call to setCenter in a timeout
    setTimeout(function() {
      this.setCenter(location);
    }.bind(this))
  }

  onGeofencesChange(event) {
    var on  = event.on;
    var off = event.off;
    var geofences  = this.state.geofences;

    // Filter out all "off" geofences.
    geofences = geofences.filter(function(geofence) {
      return off.indexOf(geofence.identifier) < 0;
    });

    // Add new "on" geofences.
    on.forEach(function(geofence) {
      var marker = geofences.find(function(m) { return m.identifier === geofence.identifier;});
      if (marker) { return; }
      geofences.push(this.createGeofenceMarker(geofence));
    }.bind(this));

    this.setState({
      geofences: geofences
    });
  }

  onPressGeofence(event) {
    console.log('NOT IMPLEMENTED');
  }

  onHeartbeat(params) {
    console.log("- heartbeat: ", params.location);
  }

  onHttp(response) {
    console.log('- http ' + response.status);
    console.log(response.responseText);
  }

  onGeofence(geofence) {
    let location = geofence.location;
    var marker = this.state.geofences.find((m) => {
      return m.identifier === geofence.identifier;
    });
    if (!marker) { return; }

    let bearing = this.bgService.getBearing(marker.center, location.coords);

    marker.fillColor = GEOFENCE_STROKE_COLOR_ACTIVATED;
    marker.strokeColor = GEOFENCE_STROKE_COLOR_ACTIVATED;

    let coords = location.coords;

    let hit = this.state.geofencesHit.find((hit) => {
      return hit.identifier === geofence.identifier;
    });

    if (!hit) {
      hit = {
        identifier: geofence.identifier,
        radius: marker.radius,
        center: {
          latitude: marker.center.latitude, 
          longitude: marker.center.longitude
        },
        events: []
      };
      this.setState({
        geofencesHit: [...this.state.geofencesHit, hit]
      });
    }
    let edgeCoordinate = this.bgService.computeOffsetCoordinate(marker.center, marker.radius, bearing);
    let event = {
      coordinates: [
        edgeCoordinate,
        {latitude: coords.latitude, longitude: coords.longitude},
      ],
      action: geofence.action,
      key: geofence.identifier + ":" + geofence.action + ":" + location.timestamp
    };
    this.setState({
      geofencesHitEvents: [...this.state.geofencesHitEvents, event]
    });
  }

  onSchedule(state) {
    console.log("- schedule", state.enabled, state);
    this.setState({
      enabled: state.enabled
    });
  }

  onRegionChange(coordinate) {

  }

  setCenter(location) {
    if (!this.refs.map || !this.state.followsUserLocation) { return; }
    this.refs.map.animateToCoordinate({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude
    });
  }

  onMapPanDrag() {
    this.setState({
      followsUserLocation: false,
      mapScrollEnabled: true
    });
    this.settingsService.set('followsUserLocation', false);
  }

  onLongPress(params) {
    var coordinate = params.nativeEvent.coordinate;
    this.bgService.playSound('LONG_PRESS_ACTIVATE');
    this.geofenceView.open(coordinate);
  }

  onSubmitGeofence(params) {
    var bgGeo = this.bgService.getPlugin();
    this.bgService.playSound('ADD_GEOFENCE');
    bgGeo.addGeofence(params, (identifier) => {
      this.setState({
        geofences: [ ...this.state.geofences, this.createGeofenceMarker(params)]
      });
    }, (error) => {
      console.warn('- addGeofence error: ', error);
    });
  }

  addMarker(location) {
    this.setState({
      markers: [...this.state.markers, this.createMarker(location)],
      coordinates: [...this.state.coordinates, {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude
      }]
    });
  }

  createMarker(location) {
    return {
      key: location.uuid,
      title: location.timestamp,
      coordinate: {
        latitude: location.coords.latitude, 
        longitude: location.coords.longitude
      }
    };
  }

  createGeofenceMarker(geofence) {
    return {
      radius: geofence.radius,
      center: {
        latitude: geofence.latitude,
        longitude: geofence.longitude
      },
      identifier: geofence.identifier,
      strokeColor:GEOFENCE_STROKE_COLOR,
      fillColor: GEOFENCE_FILL_COLOR
    }
  }

  renderMarkers() {
    let rs = [];
    if (this.state.settings.hideMarkers) { return; }

    this.state.markers.map(marker => {
      rs.push((
        <MapView.Marker
          key={marker.key}
          coordinate={marker.coordinate}
          title={marker.title}
          style={styles.marker}>
          <Text style={styles.markerIcon}></Text></MapView.Marker>
      ));
    });
    return rs;
  }

  renderActiveGeofences() {
    return this.state.geofences.map(geofence => (
      <MapView.Circle
        key={geofence.identifier}
        radius={geofence.radius}
        center={geofence.center}
        strokeWidth={1}
        strokeColor={geofence.strokeColor}
        fillColor={geofence.fillColor}
        onPress={this.onPressGeofence}
      />
    ));
  }

  renderGeofencesHit() {
    if (!this.state.settings.showGeofenceHits) { return; }
    let rs = [];
    return this.state.geofencesHit.map((hit) => {
      return (
        <MapView.Circle
          key={"hit:" + hit.identifier}
          radius={hit.radius+1}
          center={hit.center}
          strokeWidth={1}
          strokeColor={Config.colors.black}>
        </MapView.Circle>
      );
    });
  }

  renderGeofencesHitEvents() {
    if (!this.state.settings.showGeofenceHits) { return; }
    return this.state.geofencesHitEvents.map((event) => {
      let isEnter = (event.action === 'ENTER');
      let markerStyle = {
        backgroundColor: isEnter ? Config.colors.green : Config.colors.red
      };
      return (
        <View key={event.key}>
          <MapView.Polyline
            key="polyline"
            coordinates={event.coordinates}
            geodesic={true}
            strokeColor={Config.colors.black}
            strokeWidth={1}
            style={styles.geofenceHitPolyline}
            zIndex={1}
            lineCap="square" />
          <MapView.Marker
            key="edge_marker"
            coordinate={event.coordinates[0]}
            title="event"
            style={[styles.geofenceHitMarker, markerStyle]}>
              <Text style={styles.markerIcon}></Text>
          </MapView.Marker>
          <MapView.Marker
            key="location_marker"
            coordinate={event.coordinates[1]}
            style={styles.marker}>
          <Text style={styles.markerIcon}></Text></MapView.Marker>
        </View>
      );
    });
  }

  renderSyncButton() {
    return (!this.state.isSyncing) ? (
      <Icon name="ios-cloud-upload" style={styles.actionButtonIcon} size={25} />
    ) : (
      <Spinner isVisible={true} size={20} type="Circle" color="#000000" style={styles.actionButtonSpinner}/>
    );
  }

  render() {
    return (
      <View ref="workspace" style={styles.container}>
        <MapView
          ref="map"
          style={styles.map}
          showsUserLocation={true}
          onLongPress={this.onLongPress.bind(this)}
          onRegionChange={this.onRegionChange.bind(this)}
          onPanDrag={this.onMapPanDrag.bind(this)}
          scrollEnabled={this.state.mapScrollEnabled}
          showsMyLocationButton={false}
          showsPointsOfInterest={false}
          showsScale={false}
          showsTraffic={false}
          toolbarEnabled={false}
          initialRegion={{
            latitude: 37.78825,
            longitude: -122.4324,
            latitudeDelta: LATITUDE_DELTA,
            longitudeDelta: LONGITUDE_DELTA
          }}>
          <MapView.Circle
            key={this.state.stationaryLocation.timestamp}
            radius={this.state.stationaryRadius}
            fillColor={STATIONARY_REGION_FILL_COLOR}
            strokeColor={STATIONARY_REGION_STROKE_COLOR}
            strokeWidth={3}
            center={{latitude: this.state.stationaryLocation.latitude, longitude: this.state.stationaryLocation.longitude}}
          />
          <MapView.Marker
            key="Center"
            coordinate={this.state.centerCoordinate}
            title="Center"
          />
          <MapView.Polyline
            key="polyline"
            coordinates={(!this.state.settings.hidePolyline) ? this.state.coordinates : []}
            geodesic={true}
            strokeColor={Config.colors.polyline_color}
            strokeWidth={6}
            zIndex={0}
          />
          {this.renderMarkers()}
          {this.renderActiveGeofences()}
          {this.renderGeofencesHit()}
          {this.renderGeofencesHitEvents()}
        </MapView>

        <View style={[commonStyles.topToolbar, styles.topToolbar]}>
          <Text style={{width:50}}>&nbsp;</Text>
          <Text style={commonStyles.toolbarTitle}>{this.state.title}</Text>
          <Switch onValueChange={() => this.onClickEnable()} value={this.state.enabled} />
        </View>

        <View style={styles.mapMenu}>
          <View style={styles.mapMenuButtonContainer}><Icon.Button name="ios-pin" onPress={() => this.onClickMapMenu('hideMarkers')} size={20} color={(this.state.settings.hideMarkers) ? '#ccc' : Config.colors.black} backgroundColor={(this.state.settings.hideMarkers) ? '#eee' : Config.colors.gold} style={styles.mapMenuButton} iconStyle={styles.mapMenuButtonIcon} /></View>
          <View style={styles.mapMenuButtonContainer}><Icon.Button name="ios-pulse" onPress={() => this.onClickMapMenu('hidePolyline')} size={20} color={(this.state.settings.hidePolyline) ? '#ccc' : Config.colors.black} backgroundColor={(this.state.settings.hidePolyline) ? '#eee' : Config.colors.gold} style={styles.mapMenuButton} iconStyle={styles.mapMenuButtonIcon} /></View>
          <View style={styles.mapMenuButtonContainer}><Icon.Button name="ios-radio-button-off" onPress={() => this.onClickMapMenu('showGeofenceHits')} size={20} color={(!this.state.settings.showGeofenceHits) ? '#ccc' : Config.colors.black} backgroundColor={(!this.state.settings.showGeofenceHits) ? '#eee' : Config.colors.gold} style={styles.mapMenuButton} iconStyle={styles.mapMenuButtonIcon} /></View>
        </View>

        <ActionButton 
          position="left"
          onPress={this.onClickMainMenu.bind(this)}
          size={40}
          icon={<Icon name="ios-add" size={25}/>}
          verticalOrientation="down"
          buttonColor="rgba(254,221,30,1)"
          buttonTextStyle={{color: "#000"}}
          hideShadow={true}
          autoInactive={false}
          backgroundTappable={true}
          spacing={15}
          offsetX={10}
          offsetY={25}>
          <ActionButton.Item buttonColor={Config.colors.gold} onPress={() => this.onSelectMainMenu('settings')}>
            <Icon name="ios-cog" style={styles.actionButtonIcon} size={25} />
          </ActionButton.Item>

          <ActionButton.Item buttonColor={Config.colors.gold} onPress={() => this.onSelectMainMenu('resetOdometer')}>
            <Icon name="ios-speedometer" style={styles.actionButtonIcon} size={25} />
          </ActionButton.Item>

          <ActionButton.Item buttonColor={Config.colors.gold} onPress={() => this.onSelectMainMenu('emailLog')}>
            <Icon name="ios-mail" style={styles.actionButtonIcon} size={25} />
          </ActionButton.Item>
          <ActionButton.Item buttonColor={Config.colors.gold} onPress={() => this.onSelectMainMenu('sync')}>
            {this.renderSyncButton()}
          </ActionButton.Item>
          <ActionButton.Item buttonColor={Config.colors.gold} onPress={() => this.onSelectMainMenu('destroyLocations')}>
            <Icon name="ios-trash" style={styles.actionButtonIcon} size={25} />
          </ActionButton.Item>
        </ActionButton>
        <BottomToolbarView eventEmitter={eventEmitter} enabled={this.state.enabled} />
        <GeofenceView ref={(view) => {this.geofenceView = view; }} onSubmit={this.onSubmitGeofence.bind(this)}/>
        <SettingsView ref={(view) => {this.settingsView = view; }} />
      </View>
    );
  }
};

var styles = StyleSheet.create({
  topToolbar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0
  },
  container: {
    flex: 1,
    paddingTop: 46
  },
  map: {
    flex: 1
  },
  // Map Menu on top-right.  What a pain to style this thing...
  mapMenu: {
    position:'absolute',
    right: 0,
    top: 55,
    flexDirection: 'row',
  },
  mapMenuButtonContainer: {
    marginRight: 10
  },
  mapMenuButton: {
    width: 40,
    height: 40,
    padding: 5,
    flexDirection: 'row',
    justifyContent: 'center'
  },
  mapMenuButtonIcon: {
    marginRight: 0
  },
  // Floating Action Button
  actionButtonIcon: {
    color: '#000'
  },
  actionButtonSpinner: {
    marginLeft:-2,
    marginTop:-2
  },
  // Map overlay styles
  marker: {
    borderWidth:1,
    borderColor:'black',
    backgroundColor: Config.colors.polyline_color,
    borderRadius: 5,
    zIndex: 0,
    width: 10,
    height:10
  },
  geofenceHitMarker: {
    borderWidth:1,
    borderColor:'black',
    borderRadius: 6,
    zIndex: 2,
    width: 12,
    height:12
  },
  markerIcon: {
    width: 0,
    height:0
  }
});

module.exports = HomeView;
