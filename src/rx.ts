/**
 * @author [bodley.qian]
 * @email [bodley.qian@bytedance.com]
 * @create date 2019-02-26 13:24:14
 * @modify date 2019-02-26 13:24:14
 * @desc [这个东西的目的在于让一切都变成流一样的的存在] 记住一个原则，方法不过度的封装
 * 流与流可以任意组合生成一个新的流
 */
export type NullFunc = () => (void | NullFunc);
export interface IMergeType<T, K> {
    id: symbol,
    value: T | K,
    allIndex: number,
    singleIndex: number
};
let ID = 0;
export class RxObject<T> {
    static fromInterval<T = number>(
        timegap: number = 1000,
        getValue: (index: number) => T = index => index as any,
    ) {
        const newRx = new RxObject<T>();
        let hasSubscribed = false;
        newRx.onSubscribe(() => {
            if (hasSubscribed) {
                return;
            }
            hasSubscribed = true;
            let count = 0;
            const time = setInterval(() => {
                newRx.onCompleted(() => clearInterval(time));
                newRx.next(getValue(count++));
            }, timegap)
        })
        return newRx;
    }
    static fromPromise<K>(func: Promise<K>) {
        const newRx = new RxObject<K>();
        newRx.onSubscribe(() => {
            func.then(v => {
                newRx.next(v);
                newRx.complete();
            });
        });
        return newRx;
    }
    static fromValue<T>(v: T) {
        return RxObject.generate(1, i => v);
    }
    static fromArray<T>(arr: T[], time: number = 1000): RxObject<T> {
        return RxObject
            .generate(arr.length, (i) => arr[i]);
    }
    static generate<T = number>(
        size: number = 1,
        getValue: (index: number) => T = index => index as any,
    ) {
        const newRx = new RxObject<T>();
        newRx.onSubscribe(() => {
            for(let i = 0; i < size; i++) {
                if (!newRx.completed) {
                    newRx.next(getValue(i));
                }
            }
            newRx.complete();
        }, true)
        // 这里如果想要return之后再执行，那就得通过task
        // task的功能在于subscribe的时候才会执行
        return newRx;
    }
    private completed = false;
    private value: T;
    private index: number = 0;
    private completedHandlers: Array<NullFunc> = [];
    private subscribeHandlers: Array<{
        symbol: symbol,
        handler: (v: T, index: number) => void
    }> = [];
    private onSubscribeHandlers: NullFunc[] = [];
    constructor(
        value?: T,
        private id: symbol = Symbol(ID++),
    ) {
        if (value) {
            this.next(value);
        }
    }
    // 获取当前值
    getValue() {
        return this.value;
    }
    // 获取这个流的ID值
    getId() {
        return this.id;
    }
    // 下一个值 @undo
    next(value: T) {
        this.value = value;
        this.subscribeHandlers.forEach(item => item.handler(value, this.index++));
    }
    // 这个流已经完成，需要进行一系列的销毁操作 @undo
    complete() {
        if (this.completed) {
            return;
        }
        this.completed = true;
        this.completedHandlers.forEach(handler => handler());
        this.unsubscribe()
    }
    // 判断这个流是不是已经完成了 @undo
    hasCompleted() {
        return this.completed;
    }
    take(num: number, shouldComplete: boolean = false) {
        const newRx = new RxObject<T>();
        this.onCompleted(() => newRx.complete());
        newRx.onSubscribe(() => {
            let count = 0;
            this.subscribe(
                (v) => {
                    newRx.next(v);
                    count++;
                    if (count >= num) {
                        newRx.complete();
                        if (shouldComplete) {
                            this.complete();
                        }
                    }
                },
            )
        }, true)
        return newRx;
    }
    switchMap<K>(handler: (v: T) => RxObject<K>) {
        const newRx = new RxObject<K>();
        this.onCompleted(() => {newRx.complete()});
        newRx.onSubscribe(() => {
            this.subscribe((v) => {
                handler(v).subscribe(_v => newRx.next(_v));
            })
        })
        return newRx;
    }
    // 把所有的值进行汇总
    reduce<K>(handler: (lastv: K, v: T, index?: number) => K, lastv: K) {
        const newRx = new RxObject<K>();
        this.onCompleted(() => {
            newRx.next(lastv);
            newRx.complete(); // 会自动的把所有的subscribe删掉
        });
        newRx.onSubscribe(() => {
            this.subscribe(
                (v: T, index: number) => lastv = handler(lastv, v, index),
            )
        })
        return newRx;
    }
    // 转换值，生成的是一个新的流，斌不会影响之前的流 @undo
    map<K>(handler: (v: T) => K) {
        const newRx = new RxObject<K>();
        this.onCompleted(() => newRx.complete())
        newRx.onSubscribe(() => {
            this.subscribe(
                (v) => newRx.next(handler(v)),
            );
        })
        return newRx;
    }
    // 过滤不必要的值，不影响之前的流 @undo
    filter(handler: (v: T) => boolean) {
        const newRx = new RxObject<T>();
        this.onCompleted(() => newRx.complete())
        newRx.onSubscribe(() => {
            this.subscribe(
                (v) => handler(v) && newRx.next(v),
            );
        })
        return newRx;
    }
    // 阻塞值，直到对应的值返回一定的条件 @undo
    until(condition: (value: T) => boolean) {
        const newRx = new RxObject<T>();
        this.onCompleted(() => newRx.complete());
        let matched = false;
        newRx.onSubscribe(() => {
            this.subscribe(
                (v) => {
                    if (matched) {
                        newRx.next(v);
                    } else if (condition(v)) {
                        matched = true;
                    }
                }
            )
        })
        return newRx;
    }
    // 节流 主要是相当于取样
    throttle<K>(rx: RxObject<K>) {
        const newRx = new RxObject<T>();
        let powerswitch = true; // 开关，一开始是开着
        this.onCompleted(() => newRx.complete());
        rx.onCompleted(() => newRx.complete());
        newRx.onSubscribe(() => {
            this.subscribe((v) => {
                if(powerswitch) {
                    newRx.next(v);
                    powerswitch = false;
                    rx.subscribe(() => {
                        powerswitch = true
                    });
                }
            })
        })
        return newRx;
    }
    // 节流的时间
    throttleTime(gap = 0) {
        // 最小的时间单元就是1 所以直接使用时间的话可能会因为先后的顺序导致读取的数据有问题
        if (!gap || gap <= 1) {
            return this;
        }
        const newRx = new RxObject<T>();
        let powerswitch = true; // 开关，一开始是开着
        this.onCompleted(() => newRx.complete());
        newRx.onSubscribe(() => {
            this.subscribe((v) => {
                if(powerswitch) {
                    newRx.next(v);
                    powerswitch = false;
                    setTimeout(() => {powerswitch = true}, gap - 1)
                }
            })
        })
        return newRx;
    }
    // 防抖 在一定时间内有多个值，那么就先等待，直到下一个多于这个间隔
    debounceTime(gap = 10) {
        const newRx = new RxObject<T>();
        let lastv: T;
        let time: NodeJS.Timeout;
        this.onCompleted(() => newRx.complete());
        newRx.onSubscribe(() => {
            this.subscribe((v) => {
                clearTimeout(time);
                lastv = v;
                time = setTimeout(() => {
                    newRx.next(lastv);
                }, gap)
            })
        })
        return newRx;
    }

    // 监听这个流 @undo
    subscribe(handler: (value: T, index: number) => void) {
        const symbol = Symbol();
        this.subscribeHandlers.push({
            symbol,
            handler,
        });
        this.onSubscribeHandlers.forEach(h => h());
        return () => {
            let index = -1;
            for (let i = 0; i < this.subscribeHandlers.length; i++) {
                if (this.subscribeHandlers[i].symbol == symbol) {
                    index = i;
                    break;
                }
            }
            if (index >= 0) {
                this.subscribeHandlers.splice(index, 0);
            }
        }
    }
    onSubscribe(handler: NullFunc, once = false) {
        let inited = false;
        this.onSubscribeHandlers.push(() => {
            if (inited && once) {
                return;
            }
            inited = true;
            handler();
        });
        return this;
    }
    // 取消某个函数对应的监听
    unsubscribe(handler?: (value: T, index: number) => void) {
        this.subscribeHandlers.reduce((lastV: number[], item: {
            handler: (value: T, index: number) => void,
            symbol: symbol,
        }, index: number) => {
            if (!handler || handler == item.handler) {
                lastV.push(index);
            }
            return lastV;
        }, []).forEach(
            // 这里注意是position - index 因为删除一个后位置变了
            (position, index) => this.subscribeHandlers.splice(position - index, 1)
        );
    }
    // 合并流 不过是按顺序来的，前面的流完成了才开始下面的流 @undo
    concat<K>(rx: RxObject<K>): RxObject<IMergeType<T, K>> {
        const newRx = new RxObject<IMergeType<T, K>>();
        rx.onCompleted(() => {
            newRx.complete();
        })
        newRx.onSubscribe(() => {
            let count = 0;
            this.onCompleted(() => {
                rx.subscribe((value, index) => {
                    newRx.next({
                        value,
                        id: rx.getId(),
                        singleIndex: index,
                        allIndex: count++,
                    })
                })
            });
            this.subscribe((value, index) => {
                newRx.next({
                    value,
                    id: this.getId(),
                    singleIndex: index,
                    allIndex: count++,
                })
            });
        });
        return newRx;
    }
    // 合并流，两个流整合成了一个  @undo
    merge<K>(rx: RxObject<K>): RxObject<IMergeType<T, K>> {
        const newRx = new RxObject<IMergeType<T, K>>();
        const tempRx = new RxObject<null>();
        [rx, this].forEach(_temp => {
            _temp.onCompleted(() => {
                tempRx.next(null);
            });
        })
        tempRx
            .count()
            .filter(size => size == 2)
            .subscribe(() => {
                tempRx.complete();
                newRx.complete();
            })
        let count = 0;
        newRx.onSubscribe(() => {
            [this, rx].forEach(_tempRx => {
                _tempRx.subscribe((value: T | K, index: number) => {
                    newRx.next({
                        value,
                        id: this.getId(),
                        singleIndex: index,
                        allIndex: count++,
                    })
                })
            });
        })
        return newRx;
    }
    // 将多个流合并, 并整合成一个，每当所有的流都发出一个值时才会向外反射所有的值，否则就会一直等待着 @undo 
    zip<K>(...rxs: RxObject<K>[]): RxObject<{
        [prop: number]: (T | K)
    }> {
        return new RxObject();
    }
    run() {
        let value: T;
        this.subscribe(v => value = v);
        return value!;
    }
    toArray() {
        const newRx = new RxObject<T[]>();
        const arr: T[] = [];
        this.onCompleted(() => {
            newRx.next(arr);
            newRx.complete();
        })
        newRx.onSubscribe(() => {
            this.subscribe((value: T) => {
                arr.push(value);
            });
        })
        return newRx;
    }
    count() {
        const newRx = new RxObject<number>();
        this.onCompleted(() => {
            newRx.complete();
        })
        this.onSubscribe(() => {
            this.subscribe((v, index) => {
                newRx.next(index + 1);
            })
        })
        return newRx;
    }
    async toPromise() {
        // 当完成时抛出最后一个值
        return await new Promise<T>((resolve) => {
            let temp: T;
            this.onCompleted(() => {
                resolve(temp);
            })
            // subscribe记得放到最后执行
            this.subscribe((v: T) => {
                temp = v;
            });
        })
    }
    // 流完成了 一个流完成后需要做的事情
    onCompleted(handler: () => void) {
        this.completedHandlers.push(handler);
        return this;
    }
}