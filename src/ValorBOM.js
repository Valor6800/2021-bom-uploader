'use strict';

const res = require('express/lib/response');

(function() {
    var root = this;

    var has_require = typeof require !== 'undefined';
    var request = root.request;
    if (typeof request === 'undefined') {
        if (has_require) {
            request = require('request');
        } else {
            throw new Error('Requires request');
        }
    }

    var u = root.url;
    if (typeof url === 'undefined') {
        if (has_require) {
            u = require('url');
        } else {
            throw new Error('Requires url');
        }
    }

    var crypto = root.crypto;
    if (typeof crypto === 'undefined') {
        if (has_require) {
            crypto = require('crypto');
        } else {
            throw new Error('Requires crypto');
        }
    }

    class ValorBOM {

        constructor()
        {
            this.jira_base_url = process.env.JIRA_BASE_URL;
            this.onshape_base_url = process.env.ONSHAPE_BASE_URL;
            this.project_key = process.env.PROJECT_KEY;

            this.SECRET_KEY = process.env.SECRET_KEY;
            this.API_KEY = process.env.API_KEY;
            this.JIRA_KEY = process.env.JIRA_KEY;

            this.ONSHAPE_TEAM_ID = process.env.ONSHAPE_TEAM_ID;

            this.assembly_map = {};
        }

        genNonce(length) {
            var result           = '';
            var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            var charactersLength = characters.length;
            for ( var i = 0; i < length; i++ ) {
              result += characters.charAt(Math.floor(Math.random() * charactersLength));
            }
            return result;
        }

        /**
        * Generates the "Authorization" HTTP header for using the Onshape API
        *
        * @param {string} method - Request method; GET, POST, etc.
        * @param {string} url - The full request URL
        * @param {string} nonce - 25-character nonce (generated by you)
        * @param {string} authDate - UTC-formatted date string (generated by you)
        * @param {string} contentType - Value of the "Content-Type" header; generally "application/json"
        * @param {string} accessKey - API access key
        * @param {string} secretKey - API secret key
        *
        * @return {string} Value for the "Authorization" header
        */
        createSignature(method, url, nonce, authDate, contentType, accessKey, secretKey) {
            var urlObj = u.parse(url);
            var urlPath = urlObj.pathname;
            var urlQuery = urlObj.query ? urlObj.query : ''; // if no query, use empty string

            var str = (method + '\n' + nonce + '\n' + authDate + '\n' + contentType + '\n' +
                urlPath + '\n' + urlQuery + '\n').toLowerCase();

            var hmac = crypto.createHmac('sha256', secretKey)
                .update(str)
                .digest('base64');

            var signature = 'On ' + accessKey + ':HmacSHA256:' + hmac;
            return signature;
        }

        onshape_httpGET(url, cb) {
            let api_key = this.API_KEY;
            let secret_key = this.SECRET_KEY;
            let nonce = this.genNonce(25);
            var authDate = new Date().toUTCString();
            let signature = this.createSignature('GET', url, nonce, authDate, 'application/json', api_key, secret_key);

            var options = {
                'method': 'GET',
                'url': this.onshape_base_url + url,
                'headers': {
                    'Content-Type': 'application/json',
                    'Authorization': signature,
                    'On-Nonce': nonce,
                    'Date': authDate
                }
            };
            request(options, function (error, response) {
                if (error) throw new Error(error);
                cb(JSON.parse(response.body));
            });

        }

        onshape_httpEXPORT(url, cb) {
            let api_key = this.API_KEY;
            let secret_key = this.SECRET_KEY;
            let nonce = this.genNonce(25);
            var authDate = new Date().toUTCString();
            let signature = this.createSignature('GET', url, nonce, authDate, 'application/json', api_key, secret_key);

            var options = {
                'method': 'GET',
                'url': this.onshape_base_url + url,
                'headers': {
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.onshape.v1+octet-stream',
                    'Authorization': signature,
                    'On-Nonce': nonce,
                    'Date': authDate
                }
            };
            request(options, function (error, response) {
                if (error) throw new Error(error);
                cb(JSON.parse(response.body));
            });

        }

        jira_httpGET(url, cb) {
            var options = {
                'method': 'GET',
                'url': this.jira_base_url + url,
                'headers': {
                    'Content-Type': 'application/json',
                    'Authorization': 'Basic ' + this.JIRA_KEY,
                }
            };
            request(options, function (error, response) {
                if (error) throw new Error(error);
                cb(JSON.parse(response.body));
            });
        }

        jira_httpPOST(url, data, cb) {
            var options = {
              'method': 'POST',
              'url': this.jira_base_url + url,
              'headers': {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + this.JIRA_KEY,
              },
              body: JSON.stringify(data)
            };
            request(options, function (error, response) {
                if (error) throw new Error(error);
                cb(JSON.parse(response.body));
            });
        }

        jira_httpPUT(url, data, cb) {
            var options = {
              'method': 'PUT',
              'url': this.jira_base_url + url,
              'headers': {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + this.JIRA_KEY,
              },
              body: JSON.stringify(data)
            };
            request(options, function (error, response) {
                if (error) throw new Error(error);
                cb();
            });
        }

        parseEpics(result) {
            let epics = {};
            for (var i in result.issues) {
                let epic = result.issues[i];
                let key = epic.key;
                let id = epic.id;
                let summary = epic.fields.summary;
                let description = JSON.parse(epic.fields.description);
                if (description && summary.includes('['))
                    epics[id] = {'summary': summary, 'key': key, 'd': description.d, 'w': description.w, 'e': description.e};
            }
            this(epics);
        }

        parseStories(results) {
            let stories = [];
            for (var i in results.issues) {
                let story = results.issues[i];
                stories.push({
                    key: story.key,
                    material: story.fields.customfield_10700.value,
                    summary: story.fields.summary,
                    machinery: story.fields.customfield_10200[0].value,
                    powdercoat: story.fields.customfield_10900 ? story.fields.customfield_10900[0].value : 'None',
                    quantity: story.fields.customfield_10202,
                    thickness: story.fields.customfield_11001,
                    project: story.fields.project.key
                });
            }
            this(stories);
        }

        parseDocuments(results) {
            let documents = [];
            const startDate = Date.parse("2022-01-01T00:00:00.000+00:00");
            for (var i in results.items) {
                const createdAt = Date.parse(results.items[i].createdAt);
                if (!results.items[i].name.includes(`[${process.env.SEASON_ID}]`))
                    continue;
                let name = results.items[i].name.replace(`[${process.env.SEASON_ID}]`, '').trim();
                if (createdAt > startDate && /([0-9]{4})/.test(name)) {
                    documents.push({
                        d: results.items[i].id,
                        name: name,
                    });
                }
            }
            this(documents);
        }

        parseWorkspaces(results) {
            this(results.find(o => o.name === 'Main'));
        }

        parseAssemblies(results) {
            let assemblies = [];
            for (const [key, item] of Object.entries(results)) {
                let valor_part = /([0-9]{4})/.test(item.name);
                if (valor_part) {
                    if (item.name.includes('[')) {
                            assemblies.push({
                                e: item.id,
                                name: item.name,
                            });
                    }
                }
            }
            this(assemblies);
        }

        parseBOM(results) {
            let bom = { };

            let found = results.bomTable.headers.some(el => el.propertyName === 'quantity') &
                        results.bomTable.headers.some(el => el.propertyName === 'partNumber') &
                        results.bomTable.headers.some(el => el.propertyName === 'material') &
                        results.bomTable.headers.some(el => el.propertyName === 'name');

            if (!found) {
                bom.error = -1;
                bom.error_description = 'Verify the following items are in your BOM: quantity, part number, material, name';
                this(bom);
                return;
            }

            let items = results.bomTable.items;
            for (var i in items) {
                let item = items[i];

                let valor_part = /^([A-Z0-9]{5})$/.test(item.partNumber);

                if (valor_part) {
                    let part = {
                        quantity: item.quantity,
                        name: item.name,
                        partNumber: item.partNumber,
                        material: item.material.displayName,
                        thickness: 'None',
                        machinery: 'None',
                        powdercoat: 'None'
                    };
                    if (part.material.toLowerCase().includes('6061')) {
                        part.machinery = 'CNC Router';
                        part.material = 'AL 6061';
                    }
                    if (part.material.toLowerCase().includes('pla')) {
                        part.machinery = '3D Printer';
                        part.material = 'PLA';
                    }
                    if (part.material.toLowerCase().includes('nylon')) {
                        part.machinery = '3D Printer';
                        part.material = 'Nylon';
                    }
                    if (part.material.toLowerCase().includes('birch') ||
                        part.material.toLowerCase().includes('wood')) {
                        part.machinery = 'CNC Router';
                        part.material = 'Wood';
                    }
                    if (part.material.toLowerCase().includes('polycarbonate')) {
                        part.machinery = 'CNC Router';
                        part.material = 'Polycarb';
                    }
                    if (part.material.toLowerCase().includes('7075')) {
                        part.machinery = 'Manual Lathe';
                        part.material = 'AL 7075';
                    }
                    bom[item.item] = part;
                }
            }

            this(bom);
        }

        getSTL(documentId, workspaceId, elementId, partId, cb) {
            let url = `/api/parts/d/${documentId}/w/${workspaceId}/e/${elementId}/partid/${partId}/stl/?grouping=true&scale=1.0&units=millimeter&mode=binary`;
            this.onshape_httpEXPORT(url, cb);
        }

        getBOM(documentId, workspaceId, elementId, cb) {
            let url = `/api/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}/bom?multiLevel=true`;
            this.onshape_httpGET(url, this.parseBOM.bind(cb));
        }

        getEpics(cb) {
            this.jira_httpGET(`/rest/api/latest/search?jql=project = ${process.env.PROJECT_KEY} AND issuetype = Epic`,
                         this.parseEpics.bind(cb));
        }

        getEpic(partNumber, cb) {
            this.jira_httpGET(`/rest/api/latest/search?jql=project = ${process.env.PROJECT_KEY} AND issuetype = Epic AND text ~ "${partNumber}"`,
                         this.parseEpics.bind(cb));
        }

        getStoriesByPartNumber(part_number, cb) {
            this.jira_httpGET(`/rest/api/latest/search?jql=project = ${process.env.PROJECT_KEY} AND summary ~ ${part_number} AND issuetype = Story`,
                         this.parseStories.bind(cb));
        }

        getStoriesByEpic(id, cb) {
            this.jira_httpGET(`/rest/api/latest/search?jql=project = ${process.env.PROJECT_KEY} AND issuetype = Story AND "Epic Link"=${id}`,
                         this.parseStories.bind(cb));
        }

        getDocuments(cb) {
            this.onshape_httpGET(`/api/documents?q=%5B${process.env.SEASON_ID}%5D&filter=9&owner=${this.ONSHAPE_TEAM_ID}&sortColumn=createdAt&sortOrder=desc`,
                                 this.parseDocuments.bind(cb));
        }

        getWorkspace(d, cb) {
            this.onshape_httpGET(`/api/documents/d/${d}/workspaces`,
                                 this.parseWorkspaces.bind(cb));
        }

        getAssemblies(d, w, cb) {
            this.onshape_httpGET(`/api/documents/d/${d}/w/${w}/elements?elementType=ASSEMBLY`,
                                 this.parseAssemblies.bind(cb));
        }

        syncEpics() {
            this.getDocuments(function(results) {
                for (const [key, item] of Object.entries(results)) {
                    let worker1 = {};
                    worker1.d = item.d;
                    this.ctx.getWorkspace(worker1.d, function(item) {
                        if (!item) return;
                        let worker2 = {d: this.worker.d};
                        worker2.w = item.id;
                        this.ctx.getAssemblies(worker2.d, worker2.w, function(results) {
                            for (const [key, item] of Object.entries(results)) {
                                let worker3 = {d: this.worker.d, w: this.worker.w};
                                worker3.e = item.e;
                                let partNumber = item.name.substring(
                                    item.name.indexOf("[") + 1, 
                                    item.name.lastIndexOf("]")
                                );
                                worker3.partNumber = partNumber;
                                worker3.name = item.name;
                                this.ctx.getEpic(worker3.partNumber, function(results) {
                                    if (Object.keys(results).length == 0) {
                                        let payload = {
                                            summary: this.worker.name,
                                            description: JSON.stringify({
                                                d: this.worker.d,
                                                w: this.worker.w,
                                                e: this.worker.e
                                            })
                                        };
                                        this.ctx.postEpic(payload, function(results) {
                                            console.log("CREATE EPIC", results)
                                        });
                                    }
                                }.bind({ctx: this.ctx, worker: worker3}));
                            }
                        }.bind({ctx: this.ctx, worker: worker2}));
                    }.bind({ctx: this.ctx, worker: worker1}));
                }
            }.bind({ctx: this}));
        }

        postStory(payload, cb) {
            let data = {
                "fields": {
                    "project": {
                        "key": this.project_key
                    },
                    "summary": payload.summary,
                    "issuetype": {
                        "name": "Story"
                    },
                    "customfield_10200": [
                        {
                            "value": payload.machinery
                        }
                    ],
                    "customfield_10202": payload.quantity,
                    "customfield_10102": payload.epic,
                    "customfield_10700": {
                        "value": payload.material
                    },
                    "customfield_11001": {
                        "value": payload.thickness
                    },
                    "customfield_10900": [{
                        "value": payload.powdercoat
                    }]
                }
            };
            this.jira_httpPOST('/rest/api/latest/issue', data, cb);
        }

        postEpic(payload, cb) {
            let data = {
                "fields": {
                    "project": {
                        "key": this.project_key
                    },
                    "summary": payload.summary,
                    "issuetype": {
                        "name": "Epic"
                    },
                    "customfield_10104": payload.summary,
                    "description": payload.description,
                }
            };
            this.jira_httpPOST('/rest/api/latest/issue', data, cb);
        }

        putStory(key, payload, cb) {
            let data = {
                "fields": {
                    "summary": payload.summary,
                    "customfield_10200": [
                        {
                            "value": payload.machinery
                        }
                    ],
                    "customfield_10202": payload.quantity,
                    "customfield_10700": {
                        "value": payload.material
                    },
                    "customfield_11001": {
                        "value": payload.thickness
                    },
                    "customfield_10900": [
                        {
                        "value": payload.powdercoat
                        }
                    ]
                }
            };
            this.jira_httpPUT('/rest/api/latest/issue/' + key, data, cb);
        }

    };

    if ( typeof exports !== 'undefined' ) {
        if ( typeof module !== 'undefined' && module.exports ) {
            exports = module.exports = ValorBOM;
        }
        exports.ValorBOM = ValorBOM;
    } else {
        root.ValorBOM = ValorBOM;
    }

}).call(this);
