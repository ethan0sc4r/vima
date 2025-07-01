(function (root, factory) {
	if (typeof define === 'function' && define.amd) {
		// AMD
		define(['leaflet', 'shp'], factory);
	} else if (typeof exports === 'object') {
		// Node, CommonJS-like
		module.exports = factory(require('leaflet'), require('shpjs'));
	} else {
		// Browser globals
		root.L.shpfile = factory(root.L, root.shp);
	}
}(this, function (L, shp) {
	L.Shapefile = L.GeoJSON.extend({
		options: {
			importUrl: ''
		},

		initialize: function (file, options) {
			L.Util.setOptions(this, options);
			if (typeof file === 'string') {
				this.options.importUrl = file;
				this._layers = {};
				this.fire('data:loading');
				this.worker = shp.work(this.options.importUrl);
				this.worker.on('load', (data) => {
					this.addData(data);
					this.fire('data:loaded');
				});
				this.worker.on('error', (err) => {
					this.fire('data:error', err)
				})
			} else {
				this.fire('data:loading');
				shp(file).then(data => {
					this.addData(data);
					this.fire('data:loaded');
				}).catch(err => {
					this.fire('data:error', err);
				});
			}

		}
	});

	L.shpfile = function (a, b) {
		return new L.Shapefile(a, b);
	};
	return L.shpfile;
}));