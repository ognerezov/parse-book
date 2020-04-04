let response;
const AWS = require('aws-sdk')
const s3 = new AWS.S3()
const numbersBucket = 'everything-numbers';

const chapterRegex =/\d+\..*/
const formulaRegex=/\d+.=.*/
const quotationRegex = /^[^\s]+.*\)$/
const poemRegex = /\s+[^\d]*\)$/
const levelRegex = /^Уровень.*|Уровень.*/
const ruleRegex=/Принцип:.*/
const regularRegex =/[\D].*/

const textParseRegex =/\D+|\d+/g
const numberRegex =/\d+/

const allRegex=/^\d*\..*\n|\n\d*\..*\n|\d*.=.*\n|.*\)\n|^Уровень.*|\nУровень.*|\n\s+[^\d]*\)|Принцип:.*|[\D].*/g

const LEVEL = 'level';
const CHAPTER = 'chapter';
const FORMULA = 'formula';
const RULE = 'rule';
const QUOTATION = 'quotation';
const POEM = 'poem';
const REGULAR = 'regular';

function Record(type,spans,level){
    this.type = type;
    this.spans = spans;
    this.level = level;
}

function Chapter(number,level){
    this.number = number;
    this.type = CHAPTER;
    this.level = level;
    this.records = [];

    this.addSpans = spans => this.records.push(new Record(CHAPTER,spans,this.level));
    this.addRecord = (type,spans)=>this.records.push(new Record(type,spans,this.level))
}

function put(params){
    return new Promise((resolve, reject) => {
        s3.putObject(params, function (err,res) {
            if(err){
                reject(err);
                return;
            }
            resolve(res);
        });
    })

}

const admin = require("firebase-admin");

const serviceAccount = require("../everything-book-firebase");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://everything-book.firebaseio.com"
});

const bookDao = admin.firestore().collection('book');

async function putChapter(chapter) {
    const key = chapter.number +'';
    const doc =bookDao.doc(key);
    const docRef = doc.get();
    const data = JSON.parse(JSON.stringify(chapter));
    return (await docRef).exists ? doc.update(data) : doc.create(data);
}

function putNumber(chapter){
    const params = {"Bucket": numbersBucket, "Key": chapter.number+'.json', "Body": JSON.stringify(chapter)};
    return put(params);
}

async function putChapters(chapters){
 //   await Promise.all(chapters.map(putNumber))
    await Promise.all(chapters.map(putChapter))
}

exports.lambdaHandler = async (event, context) => {
    let currentLevel = -1;
    let currentChapter;
    const res = [];
    let levelRecord;
    function processText(text) {
        let parsed;

        if(levelRegex.test(text)) {
            parsed =parseTextAndNumbers (text,num=>currentLevel=num);
            levelRecord = new Record(LEVEL,parsed,currentLevel);
            return LEVEL;
        }
        if(chapterRegex.test(text)){
            parsed = parseTextAndNumbers (text,num=>currentChapter = new Chapter(num,currentLevel));
            if(levelRecord){
                currentChapter.addRecord(levelRecord);
                levelRecord = undefined;
            }
            currentChapter.addSpans(parsed);
            res.push(currentChapter);
            return CHAPTER;
        }
        if(formulaRegex.test(text)) {
            currentChapter.addRecord(FORMULA,parseTextAndNumbers(text));
            return FORMULA;
        }
        if(ruleRegex.test(text)){
            currentChapter.addRecord(RULE,parseTextAndNumbers(text));
            return RULE;
        }
        if(quotationRegex.test(text)) {
            currentChapter.addRecord(QUOTATION,parseTextAndNumbers(text));
            return QUOTATION;
        }
        if(poemRegex.test(text)) {
            currentChapter.addRecord(POEM,parseTextAndNumbers(text));
            return POEM;
        }
        currentChapter.addRecord(REGULAR,parseTextAndNumbers(text));
        return REGULAR;
    }

    function parseTextAndNumbers(str,onFirstNumberFound) {
        const res =[];
        let match;
        let shouldReactOnFound = !!onFirstNumberFound;
        do{
            match= textParseRegex.exec(str);
            if(match) {
                const text = match[0];
                const isNumber = numberRegex.test(text);
                res.push({
                    'number': isNumber,
                    'text':text
                });
                if(!isNumber || !shouldReactOnFound) continue;
                onFirstNumberFound(Number(text));
                shouldReactOnFound = false;
            }
        }while (match)

        return res;
    }

    try {
        const text = event.text;
        let match;
        do{
            match= allRegex.exec(text);
            if(match) {
                const text = match[0].trim();
                processText(text);
            }
        }while (match);
        await putChapters(res);
        // for(let i=0; i<res.length; i++){
        //     console.log(await putNumber(res[i].number,res[i]));
        // }
        response = {
            'statusCode': 200,
            'body': JSON.stringify({'message':'ok'})
        }
    } catch (err) {
        console.log(err);
        return err;
    }

    return response
};

