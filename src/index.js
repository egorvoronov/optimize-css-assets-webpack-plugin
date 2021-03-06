const postcss = require('postcss');
const postcssDiscardDuplicates = require('postcss-discard-duplicates');
const LastCallWebpackPlugin = require('./last-call-webpack-plugin');

function DedupeParentCssFromChunksWebpackPlugin(options) {
    this.options = options || {};
    this.options.assetNameRegExp = this.options.assetNameRegExp || /\.css$/g;
    this.options.filterParentsRegExp = this.options.filterParentsRegExp || this.options.assetNameRegExp;
    this.options.canPrint = this.options.canPrint !== undefined ? this.options.canPrint : true;
    this.options.map = this.options.map || undefined;

    const self = this;
    this.lastCallInstance = new LastCallWebpackPlugin({
        assetProcessors: [
            {
                phase: LastCallWebpackPlugin.PHASES.OPTIMIZE_CHUNK_ASSETS,
                regExp: this.options.assetNameRegExp,
                processor: self.dedupeCssInChunk.bind(self),
            }
        ],
        canPrint: this.options.canPrint
    });
};

DedupeParentCssFromChunksWebpackPlugin.prototype.getSplitFilenameSeparator = (assetName) => `/*splitfilename=${assetName}*/`;

DedupeParentCssFromChunksWebpackPlugin.prototype.dedupeCssInChunk = function (assetName, asset, assets, compilation) {
    const css = asset.source();

    // To check if this is a child chunk
    let chunkOfAsset = compilation.chunks.filter(chunk => chunk.files.indexOf(assetName) !== -1);
    if (chunkOfAsset.length !== 1) {
        // skipping dedupe
        console.warn('DedupeParentCssFromChunksWebpackPlugin.dedupeCssInChunk() Error getting the chunk for asset', assetName);
        return Promise.resolve(css);
    }
    chunkOfAsset = chunkOfAsset[ 0 ];

    const allParentsChunkInGroups = compilation.chunkGroups.filter(chunkGroup => chunkGroup.chunks.some(chunk => chunk.name === chunkOfAsset.name)).map(chunkGroup => chunkGroup.getParents().reduce((result, chunkGroup) => {result = result.concat(chunkGroup.chunks); return result}, []));
    const allParentsChunks = [];
    for (let parentChunksInGroup of allParentsChunkInGroups) {
        for (let parentChunk of parentChunksInGroup) {
            if (allParentsChunkInGroups.every(parentChunksInGroup2 => parentChunksInGroup2.filter(parentChunk2 => parentChunk2.name === parentChunk.name).length)) {
                allParentsChunks.push(parentChunk);
            }
        }
    }

    if (!allParentsChunks || !allParentsChunks.length) {
        // no parents then just return css
        return Promise.resolve(css);
    }

    // This is the child chunk so we need to get all the parent sources
    const allParentsFilesSources = allParentsChunks
        .map(parentChunk => parentChunk.files)
        .reduce((a, b) => a.concat(b), [])
        .filter(file => this.options.filterParentsRegExp.test(file))
        .map(file => assets.getAsset(file))
        .join('');

    if (allParentsFilesSources.trim() === '') {
        // no parent css contents then just return css
        return Promise.resolve(css);
    }

    // Create combined file for further comparison and analysing
    const newCssContent = `${css}${this.getSplitFilenameSeparator(assetName)}${allParentsFilesSources}`;

    // define discard duplicate process options
    const discardDuplicatesProcessOptions = {
        from: assetName,
        to: assetName,
        map: this.options.map,
    };

    // Add prev source map from assets in case it is not provided explicitly
    if (this.options.map && !this.options.map.prev) {
        try {
            const mapJson = assets.getAsset(assetName + '.map');
            if (mapJson) {
                const map = JSON.parse(mapJson);
                if (
                    map &&
                    (
                        (map.sources && map.sources.length > 0) ||
                        (map.mappings && map.mappings.length > 0)
                    )
                ) {
                    discardDuplicatesProcessOptions.map = Object.assign({ prev: mapJson }, this.options.map);
                }
            }
        } catch (err) {
            console.warn('DedupeParentCssFromChunksWebpackPlugin.dedupeCssInChunk() Error getting previous source map', err);
        }
    }

    // remove duplicates
    return postcss(postcssDiscardDuplicates).process(newCssContent, discardDuplicatesProcessOptions)
        .then((result) => {
            let dedupedCss = result.css;

            // remove all before splitfilename with index of splitfilename
            const filenameseparatorIndex = dedupedCss.indexOf(this.getSplitFilenameSeparator(assetName));
            dedupedCss = dedupedCss.slice(0, filenameseparatorIndex);

            if (this.options.map && result.map && result.map.toString) {
                // todo we need to slice sourcemap as well starting from filenameseparatorIndex
                assets.setAsset(assetName + '.map', result.map.toString());
            }

            return dedupedCss;
        });
};

DedupeParentCssFromChunksWebpackPlugin.prototype.apply = function (compiler) {
    return this.lastCallInstance.apply(compiler);
};

module.exports = DedupeParentCssFromChunksWebpackPlugin;
